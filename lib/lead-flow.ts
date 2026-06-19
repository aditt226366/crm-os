import { Prisma, type IntegrationType, type WhatsAppTemplate } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { safeCreateAuditLog } from "@/lib/audit";
import { INTEGRATION_DEFINITIONS, type FeatureKey } from "@/lib/constants";
import { readGoogleSheetLeads, type SheetLead } from "@/lib/google-sheets-leads";
import { createOutboundConversationMessage, normalizePhone, serializeConversation, serializeMessage } from "@/lib/inbox";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";
import { recordUsage } from "@/lib/usage";
import { emitTenantEvent } from "@/lib/realtime";
import { renderTemplateBody, sendWhatsAppTemplateMessage } from "@/lib/whatsapp-cloud";

const FLOW_INTEGRATIONS = ["GOOGLE_SHEETS", "WHATSAPP_CLOUD", "WHATSAPP_TEMPLATE_SETTINGS", "KNOWLEDGE_BASE", "AI_MODEL"] as const;

type FlowIntegration = {
  type: IntegrationType;
  status: string;
  encryptedConfig: unknown;
  lastVerificationError: string | null;
};

type LeadTemplate = {
  id: string | null;
  name: string;
  language: string;
  status: string;
  body: string;
};

function integrationMap(integrations: FlowIntegration[]) {
  return new Map(integrations.map((integration) => [integration.type, integration]));
}

function assertConnected(
  integrations: Map<IntegrationType, FlowIntegration>,
  type: IntegrationType,
  message: string
): IntegrationConfig {
  const integration = integrations.get(type);
  if (integration?.status !== "CONNECTED") {
    throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", integration?.lastVerificationError || message);
  }
  return readEncryptedConfig(integration.encryptedConfig);
}

function configuredTemplate(config: IntegrationConfig): LeadTemplate | null {
  const name = config.WHATSAPP_TEMPLATE_NAME?.trim();
  if (!name) return null;

  return {
    id: null,
    name,
    language: config.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en_US",
    status: "APPROVED",
    body: `Approved WhatsApp template: ${name}`
  };
}

function templateFromRecord(template: WhatsAppTemplate): LeadTemplate {
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    status: template.status,
    body: template.body
  };
}

async function resolveTemplate({
  tenantId,
  templateId,
  templateSettingsConfig
}: {
  tenantId: string;
  templateId?: string;
  templateSettingsConfig: IntegrationConfig;
}) {
  if (templateId) {
    const template = await prisma.whatsAppTemplate.findFirst({
      where: { tenantId, id: templateId, status: "APPROVED" }
    });
    if (!template) {
      throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Approved template not found for this company.");
    }
    return templateFromRecord(template);
  }

  const configured = configuredTemplate(templateSettingsConfig);
  const template = configured
    ? await prisma.whatsAppTemplate.findFirst({
        where: {
          tenantId,
          name: configured.name,
          language: configured.language,
          status: "APPROVED"
        }
      })
    : await prisma.whatsAppTemplate.findFirst({
        where: { tenantId, status: "APPROVED" },
        orderBy: { updatedAt: "desc" }
      });

  if (template) return templateFromRecord(template);
  if (configured) return configured;

  throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Approved template not found for this company.");
}

function templateVariables(templateBody: string, lead: SheetLead) {
  const keys = Array.from(templateBody.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)).map((match) => match[1]);
  const uniqueKeys = Array.from(new Set(keys));
  const named: Record<string, string> = {};

  uniqueKeys.forEach((key, index) => {
    const normalized = key.toLowerCase();
    if (normalized === "1" || normalized.includes("name") || normalized.includes("customer")) {
      named[key] = lead.name || "there";
    } else if (normalized === "2" || normalized.includes("phone") || normalized.includes("number")) {
      named[key] = lead.phone;
    } else {
      named[key] = lead.row[index] || lead.name || lead.phone;
    }
  });

  return {
    named,
    positional: uniqueKeys.map((key) => named[key] || lead.name || lead.phone)
  };
}

async function safeRecordUsage(input: {
  tenantId: string;
  feature: FeatureKey;
  provider: string;
  eventType: string;
  endpoint?: string;
  units: number;
  cost: number;
  status: string;
  metadata?: unknown;
}) {
  try {
    await recordUsage(input);
  } catch (error) {
    console.error("[lead-flow.usage] failed", error instanceof Error ? error.message : String(error));
  }
}

async function currentFlowIntegrations(tenantId: string) {
  await ensureIntegrationSchema();
  await ensureLeadWorkspaceSchema();
  return prisma.integration.findMany({
    where: { tenantId, type: { in: [...FLOW_INTEGRATIONS] } },
    select: {
      type: true,
      status: true,
      encryptedConfig: true,
      lastVerificationError: true
    }
  });
}

async function syncConfiguredApprovedTemplate(tenantId: string) {
  await ensureLeadWorkspaceSchema();
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: "WHATSAPP_TEMPLATE_SETTINGS"
      }
    },
    select: { status: true, encryptedConfig: true }
  });

  if (integration?.status !== "CONNECTED") {
    return null;
  }

  const configured = configuredTemplate(readEncryptedConfig(integration.encryptedConfig));
  if (!configured) {
    return null;
  }

  return prisma.whatsAppTemplate.upsert({
    where: {
      tenantId_name_language: {
        tenantId,
        name: configured.name,
        language: configured.language
      }
    },
    create: {
      tenantId,
      name: configured.name,
      language: configured.language,
      category: "MARKETING",
      status: "APPROVED",
      body: configured.body,
      components: {
        source: "integration-settings"
      } as Prisma.InputJsonValue
    },
    update: {
      status: "APPROVED"
    }
  });
}

export async function leadFlowSummary(tenantId: string) {
  await syncConfiguredApprovedTemplate(tenantId);
  const [integrations, templates, leads, totals] = await Promise.all([
    currentFlowIntegrations(tenantId),
    prisma.whatsAppTemplate.findMany({
      where: { tenantId, status: "APPROVED" },
      orderBy: [{ updatedAt: "desc" }],
      take: 20
    }),
    prisma.lead.findMany({
      where: { tenantId },
      include: {
        contact: true,
        conversation: {
          include: {
            messages: { orderBy: { createdAt: "desc" }, take: 1 }
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 30
    }),
    prisma.lead.groupBy({
      by: ["temperature"],
      where: { tenantId },
      _count: { _all: true }
    })
  ]);

  const mappedIntegrations = FLOW_INTEGRATIONS.map((type) => {
    const integration = integrations.find((item) => item.type === type);
    return {
      type,
      name: INTEGRATION_DEFINITIONS[type].name,
      status: integration?.status ?? "NOT_CONNECTED",
      ready: integration?.status === "CONNECTED",
      message: integration?.lastVerificationError ?? null
    };
  });

  return {
    integrations: mappedIntegrations,
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      body: template.body,
      updatedAt: template.updatedAt.toISOString()
    })),
    metrics: {
      total: totals.reduce((sum, row) => sum + row._count._all, 0),
      hot: totals.find((row) => row.temperature === "HOT")?._count._all ?? 0,
      warm: totals.find((row) => row.temperature === "WARM")?._count._all ?? 0,
      scrap: totals.find((row) => row.temperature === "SCRAP")?._count._all ?? 0
    },
    leads: leads.map((lead) => ({
      id: lead.id,
      status: lead.status,
      temperature: lead.temperature,
      source: lead.source,
      productInterest: lead.productInterest,
      updatedAt: lead.updatedAt.toISOString(),
      contact: {
        id: lead.contact.id,
        name: lead.contact.name,
        phone: lead.contact.phone,
        optOut: lead.contact.optOut,
        customerReplyCount: lead.contact.customerReplyCount,
        totalMessageCount: lead.contact.totalMessageCount,
        lastContactedAt: lead.contact.lastContactedAt?.toISOString() ?? null
      },
      conversation: lead.conversation
        ? {
            id: lead.conversation.id,
            status: lead.conversation.status,
            humanTakeover: lead.conversation.humanTakeover,
            lastMessageText: lead.conversation.lastMessageText,
            lastMessageAt: lead.conversation.lastMessageAt?.toISOString() ?? null,
            lastMessageStatus: lead.conversation.messages[0]?.status ?? null
          }
        : null
    }))
  };
}

async function upsertLeadConversation({ tenantId, lead }: { tenantId: string; lead: SheetLead }) {
  const now = new Date();
  const phone = normalizePhone(lead.phone);
  const contact = await prisma.contact.upsert({
    where: {
      tenantId_phone: {
        tenantId,
        phone
      }
    },
    create: {
      tenantId,
      name: lead.name || phone,
      phone,
      source: "GOOGLE_SHEET",
      tags: ["google-sheet"],
      customFields: {
        googleSheet: {
          rowNumber: lead.rowNumber,
          row: lead.row
        }
      } as Prisma.InputJsonValue,
      lastMessageAt: now
    },
    update: {
      name: lead.name || undefined,
      source: "GOOGLE_SHEET",
      customFields: {
        googleSheet: {
          rowNumber: lead.rowNumber,
          row: lead.row
        }
      } as Prisma.InputJsonValue
    }
  });

  const conversation =
    (await prisma.conversation.findFirst({
      where: {
        tenantId,
        contactId: contact.id,
        status: { not: "RESOLVED" }
      },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }]
    })) ??
    (await prisma.conversation.create({
      data: {
        tenantId,
        contactId: contact.id,
        source: "GOOGLE_SHEET",
        sourceId: `row:${lead.rowNumber}`,
        status: "OPEN"
      }
    }));

  const existingLead = await prisma.lead.findFirst({
    where: { tenantId, contactId: contact.id }
  });

  const crmLead = existingLead
    ? await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          conversationId: conversation.id,
          source: "GOOGLE_SHEET",
          status: existingLead.status,
          updatedAt: now
        }
      })
    : await prisma.lead.create({
        data: {
          tenantId,
          contactId: contact.id,
          conversationId: conversation.id,
          source: "GOOGLE_SHEET",
          temperature: "SCRAP",
          status: "NEW"
        }
      });

  return { contact, conversation, lead: crmLead };
}

async function alreadySentTemplate({
  tenantId,
  conversationId,
  templateId
}: {
  tenantId: string;
  conversationId: string;
  templateId: string | null;
}) {
  if (!templateId) return false;

  const existing = await prisma.message.findFirst({
    where: {
      tenantId,
      conversationId,
      templateId,
      direction: "OUTBOUND",
      type: "TEMPLATE",
      status: { in: ["PENDING", "SENT", "DELIVERED", "READ"] }
    },
    select: { id: true }
  });

  return Boolean(existing);
}

export async function runGoogleSheetLeadFlow({
  tenantId,
  userId,
  templateId,
  range,
  maxRows
}: {
  tenantId: string;
  userId: string;
  templateId?: string;
  range?: string;
  maxRows?: number;
}) {
  await syncConfiguredApprovedTemplate(tenantId);
  const integrations = integrationMap(await currentFlowIntegrations(tenantId));
  const sheetsConfig = assertConnected(
    integrations,
    "GOOGLE_SHEETS",
    "Google Sheets is not connected for this company."
  );
  const whatsappConfig = assertConnected(
    integrations,
    "WHATSAPP_CLOUD",
    "WhatsApp Cloud API is not connected for this company."
  );
  const templateSettingsConfig = assertConnected(
    integrations,
    "WHATSAPP_TEMPLATE_SETTINGS",
    "WhatsApp template settings are not configured for this company."
  );
  assertConnected(integrations, "KNOWLEDGE_BASE", "Knowledge base is not connected for this company.");
  assertConnected(integrations, "AI_MODEL", "AI model is not connected for this company.");

  const template = await resolveTemplate({ tenantId, templateId, templateSettingsConfig });
  const sheetLeads = await readGoogleSheetLeads({
    config: sheetsConfig,
    range: range || "A:Z",
    maxRows: Math.min(Math.max(maxRows ?? 50, 1), 200)
  });

  const results = [];

  for (const sheetLead of sheetLeads) {
    const { contact, conversation } = await upsertLeadConversation({ tenantId, lead: sheetLead });

    if (contact.optOut) {
      results.push({ phone: contact.phone, status: "skipped", reason: "Contact opted out" });
      continue;
    }

    if (await alreadySentTemplate({ tenantId, conversationId: conversation.id, templateId: template.id })) {
      results.push({ phone: contact.phone, status: "skipped", reason: "Template already sent" });
      continue;
    }

    const variables = templateVariables(template.body, sheetLead);
    const sendResult = await sendWhatsAppTemplateMessage({
      config: whatsappConfig,
      to: contact.phone,
      templateName: template.name,
      language: template.language,
      variables: variables.positional
    });
    const preview = renderTemplateBody(template.body, variables.named);
    const outbound = await createOutboundConversationMessage({
      tenantId,
      conversationId: conversation.id,
      type: "TEMPLATE",
      templateId: template.id ?? undefined,
      body: preview,
      whatsappMessageId: sendResult.whatsappMessageId,
      status: sendResult.ok ? "PENDING" : "FAILED",
      failureReason: sendResult.error ?? null,
      metadata: {
        sentByUserId: userId,
        adapter: "lead-google-sheets-flow",
        templateName: template.name,
        templateLanguage: template.language,
        sheetRowNumber: sheetLead.rowNumber,
        variables: variables.named
      }
    });

    await safeRecordUsage({
      tenantId,
      feature: "LEAD_MANAGEMENT",
      provider: "meta",
      eventType: sendResult.ok ? "lead_template.queued" : "lead_template.failed",
      endpoint: "/api/app/leads",
      units: 1,
      cost: sendResult.ok ? 0.006 : 0,
      status: sendResult.ok ? "SUCCESS" : "FAILED",
      metadata: { messageId: outbound.message.id, templateName: template.name, sheetRowNumber: sheetLead.rowNumber }
    });

    const payload = {
      conversation: serializeConversation(outbound.conversation),
      message: serializeMessage(outbound.message)
    };
    emitTenantEvent(tenantId, "message.created", payload);
    emitTenantEvent(tenantId, "conversation.updated", payload.conversation);

    results.push({
      phone: contact.phone,
      status: sendResult.ok ? "sent" : "failed",
      reason: sendResult.error ?? null,
      conversationId: conversation.id,
      messageId: outbound.message.id,
      whatsappMessageId: sendResult.whatsappMessageId ?? null
    });
  }

  await safeCreateAuditLog({
    actorUserId: userId,
    tenantId,
    action: "lead.google_sheet_flow_run",
    entityType: "Lead",
    newValue: {
      range: range || "A:Z",
      maxRows: maxRows ?? 50,
      scanned: sheetLeads.length,
      sent: results.filter((result) => result.status === "sent").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length
    }
  });

  return {
    scanned: sheetLeads.length,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results
  };
}
