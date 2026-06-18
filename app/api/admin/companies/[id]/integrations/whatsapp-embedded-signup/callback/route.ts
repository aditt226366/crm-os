import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError } from "@/lib/api";
import { integrationErrorResponse, integrationSuccess } from "@/lib/integrations/responses";
import { writeAuditLog } from "@/lib/audit";
import { serializeIntegration } from "@/lib/serializers";
import { encryptJson, scrubSecretsFromLogs } from "@/lib/security";
import { encryptionConfigured, maskedDisplayForConfig, webhookUrlForTenant, type IntegrationConfig } from "@/lib/integration-vault";
import { validateMetaEmbeddedSignupEnv } from "@/lib/integration-env";

type Context = { params: Promise<{ id: string }> };

const callbackSchema = z
  .object({
    code: z.string().trim().min(1),
    waba_id: z.string().trim().min(1).optional(),
    wabaId: z.string().trim().min(1).optional(),
    phone_number_id: z.string().trim().min(1).optional(),
    phoneNumberId: z.string().trim().min(1).optional()
  })
  .transform((data, ctx) => {
    const wabaId = data.waba_id ?? data.wabaId;
    const phoneNumberId = data.phone_number_id ?? data.phoneNumberId;

    if (!wabaId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["waba_id"],
        message: "WABA ID is required"
      });
    }

    if (!phoneNumberId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone_number_id"],
        message: "Phone number ID is required"
      });
    }

    return {
      code: data.code,
      wabaId: wabaId ?? "",
      phoneNumberId: phoneNumberId ?? ""
    };
  });

function asJson(value: Record<string, unknown> | undefined) {
  return value as Prisma.InputJsonValue | undefined;
}

function graphVersion() {
  const version = process.env.META_GRAPH_VERSION?.trim() || "v20.0";
  return version.startsWith("v") ? version : `v${version}`;
}

function appBaseUrl(request: NextRequest) {
  return (process.env.APP_URL?.trim() || request.nextUrl.origin).replace(/\/$/, "");
}

function webhookVerifyToken() {
  return (
    process.env.WHATSAPP_VERIFY_TOKEN?.trim() ||
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() ||
    crypto.randomBytes(24).toString("base64url")
  );
}

async function exchangeCodeForAccessToken(code: string) {
  const integrationEnv = validateMetaEmbeddedSignupEnv();
  if (!integrationEnv.ok) {
    throw new ApiError(500, "META_CONFIGURATION_MISSING", "Meta Embedded Signup is not configured on the server.");
  }

  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    throw new ApiError(500, "META_CONFIGURATION_MISSING", "Meta Embedded Signup is not configured on the server.");
  }

  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      code
    })
  });
  const text = await response.text();
  let payload: unknown = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(502, "META_CODE_EXCHANGE_FAILED", "Meta code exchange failed.");
  }

  const accessToken =
    payload && typeof payload === "object" && "access_token" in payload
      ? (payload as { access_token?: unknown }).access_token
      : null;

  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new ApiError(502, "META_ACCESS_TOKEN_MISSING", "Meta did not return an access token.");
  }

  return accessToken;
}

function statusPayload({
  config,
  metadata,
  lastVerifiedAt,
  updatedAt,
  webhookUrl
}: {
  config: IntegrationConfig;
  metadata: Record<string, unknown>;
  lastVerifiedAt: Date | null;
  updatedAt: Date;
  webhookUrl: string;
}) {
  const masked = maskedDisplayForConfig("WHATSAPP_CLOUD", config) as Record<string, string>;
  return {
    connected: true,
    wabaId: typeof masked.WHATSAPP_BUSINESS_ACCOUNT_ID === "string" ? masked.WHATSAPP_BUSINESS_ACCOUNT_ID : null,
    phoneNumberId: typeof masked.WHATSAPP_PHONE_NUMBER_ID === "string" ? masked.WHATSAPP_PHONE_NUMBER_ID : null,
    tokenExists: Boolean(config.WHATSAPP_ACCESS_TOKEN),
    lastConnectedAt:
      typeof metadata.lastConnectedAt === "string"
        ? metadata.lastConnectedAt
        : (lastVerifiedAt ?? updatedAt).toISOString(),
    webhookUrl
  };
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await context.params;
    const body = callbackSchema.parse(await request.json());
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true }
    });

    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }
    if (!encryptionConfigured()) {
      throw new ApiError(500, "ENCRYPTION_NOT_CONFIGURED", "Server encryption is not configured.");
    }

    const accessToken = await exchangeCodeForAccessToken(body.code);
    const config: IntegrationConfig = {
      WHATSAPP_BUSINESS_ACCOUNT_ID: body.wabaId,
      WHATSAPP_PHONE_NUMBER_ID: body.phoneNumberId,
      WHATSAPP_ACCESS_TOKEN: accessToken,
      WHATSAPP_VERIFY_TOKEN: webhookVerifyToken()
    };
    const baseUrl = appBaseUrl(request);
    const webhookUrl = `${baseUrl}/api/webhooks/whatsapp`;
    const metadata = {
      source: "meta_embedded_signup",
      webhookUrl,
      tenantWebhookUrl: webhookUrlForTenant({ origin: baseUrl, tenantSlug: tenant.slug, tenantId: tenant.id }),
      lastConnectedAt: new Date().toISOString(),
      connectedPhoneNumberId: body.phoneNumberId,
      connectedWabaId: body.wabaId
    };
    const maskedDisplay = maskedDisplayForConfig("WHATSAPP_CLOUD", config);
    const integration = await prisma.integration.upsert({
      where: { tenantId_type: { tenantId: tenant.id, type: "WHATSAPP_CLOUD" } },
      create: {
        tenantId: tenant.id,
        type: "WHATSAPP_CLOUD",
        status: "CONNECTED",
        encryptedConfig: encryptJson(config),
        maskedDisplay: asJson(maskedDisplay),
        metadata: asJson(metadata),
        lastVerifiedAt: new Date(),
        lastVerificationError: null,
        createdById: admin.id,
        updatedById: admin.id
      },
      update: {
        status: "CONNECTED",
        encryptedConfig: encryptJson(config),
        maskedDisplay: asJson(maskedDisplay),
        metadata: asJson(metadata),
        lastVerifiedAt: new Date(),
        lastVerificationError: null,
        updatedById: admin.id
      },
      include: { createdBy: true, updatedBy: true }
    });

    await writeAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: tenant.id,
      action: "admin.integration_whatsapp_embedded_signup_connected",
      entityType: "Integration",
      entityId: integration.id,
      newValue: scrubSecretsFromLogs({
        type: "WHATSAPP_CLOUD",
        status: "CONNECTED",
        metadata,
        maskedDisplay
      })
    });

    return integrationSuccess({
      message: `WhatsApp connected successfully for ${tenant.name}.`,
      integration: serializeIntegration(integration),
      status: statusPayload({
        config,
        metadata,
        lastVerifiedAt: integration.lastVerifiedAt,
        updatedAt: integration.updatedAt,
        webhookUrl
      })
    });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
