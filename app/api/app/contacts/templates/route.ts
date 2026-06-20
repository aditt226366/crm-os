import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse, json } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { safeCreateAuditLog } from "@/lib/audit";
import { fetchWhatsAppTemplateDetails } from "@/lib/whatsapp-cloud";
import { readEncryptedConfig } from "@/lib/integration-vault";

const PROVIDER_TIMEOUT_MS = 15_000;
const categories = new Set(["MARKETING", "UTILITY", "AUTHENTICATION"]);

function graphApiVersion() {
  const version = process.env.META_GRAPH_VERSION?.trim() || "v20.0";
  return version.startsWith("v") ? version : `v${version}`;
}

function templateStatus(value: unknown) {
  const status = String(value ?? "PENDING").toUpperCase();
  if (status === "APPROVED" || status === "REJECTED" || status === "PAUSED" || status === "DISABLED") {
    return status;
  }
  return "PENDING";
}

function extractVariables(body: string) {
  return Array.from(body.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)).map((match) => match[1]);
}

async function postMetaTemplate(config: Record<string, string>, input: { name: string; language: string; category: string; body: string }) {
  const wabaId = config.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  const token = config.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!wabaId || !token) {
    throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", "WhatsApp Cloud API is not connected for this company.");
  }

  const variables = extractVariables(input.body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(`https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(wabaId)}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        name: input.name,
        language: input.language,
        category: input.category,
        components: [
          {
            type: "BODY",
            text: input.body,
            ...(variables.length
              ? {
                  example: {
                    body_text: [variables.map((variable) => (variable.toLowerCase().includes("phone") ? "+971500000000" : "Customer"))]
                  }
                }
              : {})
          }
        ]
      })
    });
    const data = (await response.json().catch(() => null)) as {
      id?: string;
      status?: string;
      error?: { message?: string; error_user_msg?: string };
    } | null;

    if (!response.ok) {
      const message = data?.error?.error_user_msg ?? data?.error?.message ?? "Meta template submission failed.";
      if (/already exists|duplicate/i.test(message)) {
        return { duplicate: true as const };
      }
      throw new ApiError(409, "META_TEMPLATE_REJECTED", message);
    }

    return {
      duplicate: false as const,
      metaTemplateId: data?.id ?? null,
      status: templateStatus(data?.status)
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(504, "META_TEMPLATE_TIMEOUT", "Meta template submission timed out.");
    }
    throw new ApiError(409, "META_TEMPLATE_REJECTED", "Meta template submission failed.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "CONTACTS");
    const tenantId = user.tenantId!;
    await ensureLeadWorkspaceSchema();

    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const language = String(body.language ?? "en_US").trim();
    const category = String(body.category ?? "MARKETING").trim().toUpperCase();
    const templateBody = String(body.body ?? "").trim();

    if (!/^[a-z0-9_]{2,512}$/.test(name)) {
      throw new ApiError(400, "TEMPLATE_NAME_INVALID", "Template name must use lowercase letters, numbers, and underscores.");
    }
    if (!language) {
      throw new ApiError(400, "TEMPLATE_LANGUAGE_INVALID", "Template language is required.");
    }
    if (!categories.has(category)) {
      throw new ApiError(400, "TEMPLATE_CATEGORY_INVALID", "Template category is invalid.");
    }
    if (templateBody.length < 3) {
      throw new ApiError(400, "TEMPLATE_BODY_INVALID", "Template body is required.");
    }

    const integration = await prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } }
    });

    let metaTemplateId: string | null = null;
    let status = "PENDING";
    let message = "Template saved locally. Connect WhatsApp Cloud API to submit it to Meta.";
    let components: Prisma.InputJsonValue = [{ type: "BODY", text: templateBody }];

    if (integration?.status === "CONNECTED") {
      const config = readEncryptedConfig(integration.encryptedConfig);
      const submit = await postMetaTemplate(config, { name, language, category, body: templateBody });
      if (submit.duplicate) {
        const details = await fetchWhatsAppTemplateDetails({ config, templateName: name, language });
        metaTemplateId = details?.metaTemplateId ?? null;
        status = templateStatus(details?.status);
        components = (details?.components ?? components) as Prisma.InputJsonValue;
        message = status === "APPROVED" ? "Template accepted by Meta." : "Template found in Meta. Waiting for approval.";
      } else {
        metaTemplateId = submit.metaTemplateId;
        status = submit.status;
        message = status === "APPROVED" ? "Template accepted by Meta." : "Template submitted to Meta. Waiting for approval.";
      }
    }

    const variables = extractVariables(templateBody);
    const template = await prisma.whatsAppTemplate.upsert({
      where: {
        tenantId_name_language: {
          tenantId,
          name,
          language
        }
      },
      create: {
        tenantId,
        metaTemplateId,
        name,
        language,
        category: category as "MARKETING",
        status: status as "PENDING",
        body: templateBody,
        variables: variables as Prisma.InputJsonValue,
        components
      },
      update: {
        metaTemplateId,
        category: category as "MARKETING",
        status: status as "PENDING",
        body: templateBody,
        variables: variables as Prisma.InputJsonValue,
        components
      }
    });

    void safeCreateAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "contacts.template_submitted",
      entityType: "WhatsAppTemplate",
      entityId: template.id,
      newValue: {
        name,
        language,
        category,
        status
      }
    });

    return json({
      ok: true,
      message,
      template: {
        id: template.id,
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
        body: template.body,
        updatedAt: template.updatedAt.toISOString()
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
