import { Prisma, type IntegrationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { safeCreateAuditLog } from "@/lib/audit";
import { INTEGRATION_DEFINITIONS, type FeatureKey } from "@/lib/constants";
import {
  ensureGoogleSheetStatusColumn,
  readGoogleSheetLeads,
  updateGoogleSheetLeadStatuses,
  type SheetLead
} from "@/lib/google-sheets-leads";
import { createOutboundConversationMessage, normalizePhone, serializeConversation, serializeMessage } from "@/lib/inbox";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";
import { recordUsage } from "@/lib/usage";
import { emitTenantEvent } from "@/lib/realtime";
import { type WhatsAppTemplateLead } from "@/lib/whatsapp-cloud";
import { templateVariableConfig } from "@/lib/whatsapp-template-config";
import {
  loadTenantTemplateMessageConfig,
  sendTemplateMessage,
  TEMPLATE_SETTINGS_NOT_CONFIGURED_MESSAGE
} from "@/lib/tenant-template-messaging";
import {
  activeMetaDeliveryLimit,
  activeMetaDeliveryLimitFromMessage,
  createMetaDeliveryLimit,
  isMetaDeliveryLimitError,
  META_DELIVERY_LIMIT_DISPLAY,
  metaDeliveryLimitReason,
  withContactMetaDeliveryLimit,
  withMetaDeliveryLimitMetadata
} from "@/lib/meta-delivery-limit";

const FLOW_INTEGRATIONS = ["GOOGLE_SHEETS", "WHATSAPP_CLOUD", "WHATSAPP_TEMPLATE_SETTINGS", "KNOWLEDGE_BASE", "AI_MODEL"] as const;
const DEFAULT_SEND_GAP_MS = 6000;

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
  components?: unknown;
};

function leadTemplateInput(lead: SheetLead): WhatsAppTemplateLead {
  return {
    name: lead.name,
    phone: lead.phone,
    status: lead.status,
    row: lead.row
  };
}

function configuredLeadSendGapMs() {
  const value = Number(process.env.LEAD_SHEET_SEND_GAP_MS);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_SEND_GAP_MS;
  return Math.min(Math.round(value), 60_000);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
  const templateConfig = templateVariableConfig(config, "MAIN");
  if (!templateConfig) return null;

  return {
    id: null,
    name: templateConfig.name,
    language: templateConfig.language,
    status: "APPROVED",
    body: `Approved WhatsApp template: ${templateConfig.name}`,
    components: null
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

function normalizedSheetStatus(status: string | null) {
  return status?.trim().toLowerCase() ?? "";
}

async function activeMetaDeliveryLimitForContact({
  tenantId,
  contactId,
  customFields
}: {
  tenantId: string;
  contactId: string;
  customFields: unknown;
}) {
  const contactLimit = activeMetaDeliveryLimit(customFields);
  if (contactLimit) return contactLimit;

  const recentFailures = await prisma.message.findMany({
    where: {
      tenantId,
      contactId,
      direction: "OUTBOUND",
      type: "TEMPLATE",
      status: "FAILED",
      updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      metadata: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true
    }
  });

  for (const failure of recentFailures) {
    const limit = activeMetaDeliveryLimitFromMessage(failure);
    if (!limit) continue;
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        customFields: withContactMetaDeliveryLimit(customFields, limit, failure.id) as Prisma.InputJsonValue
      }
    });
    return limit;
  }

  return null;
}

function shouldMessageSheetLead(lead: SheetLead) {
  if (lead.statusColumnIndex === null) {
    return true;
  }

  const status = normalizedSheetStatus(lead.status);
  return !status || status === "new";
}

async function safeMarkSheetLeadStatus({
  config,
  range,
  lead,
  status
}: {
  config: IntegrationConfig;
  range: string;
  lead: SheetLead;
  status: string;
}) {
  if (lead.statusColumnIndex === null) {
    return { ok: true, skipped: true as const };
  }

  try {
    await updateGoogleSheetLeadStatuses({
      config,
      range,
      updates: [{ rowNumber: lead.rowNumber, statusColumnIndex: lead.statusColumnIndex, status }]
    });
    return { ok: true, skipped: false as const };
  } catch (error) {
    console.error("[lead-flow.sheets] status update failed", error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      skipped: false as const,
      error: error instanceof Error ? error.message : "Google Sheets status update failed"
    };
  }
}

async function safeMarkSheetLeadMessaged(input: Omit<Parameters<typeof safeMarkSheetLeadStatus>[0], "status">) {
  return safeMarkSheetLeadStatus({ ...input, status: "messaged" });
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
  const integrations = await currentFlowIntegrations(tenantId);
  const templates = await prisma.whatsAppTemplate.findMany({
    where: { tenantId, status: "APPROVED" },
    orderBy: [{ updatedAt: "desc" }],
    take: 20
  });
  const leads = await prisma.lead.findMany({
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
  });
  const totals = await prisma.lead.groupBy({
    by: ["temperature"],
    where: { tenantId },
    _count: { _all: true }
  });

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
        ? (() => {
            const latestMessage = lead.conversation.messages[0];
            const deliveryLimit = activeMetaDeliveryLimitFromMessage(latestMessage);
            return {
              id: lead.conversation.id,
              status: lead.conversation.status,
              humanTakeover: lead.conversation.humanTakeover,
              lastMessageText: lead.conversation.lastMessageText,
              lastMessageAt: lead.conversation.lastMessageAt?.toISOString() ?? null,
              lastMessageStatus: deliveryLimit ? "META_DELIVERY_LIMITED" : (latestMessage?.status ?? null)
            };
          })()
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

async function markCrmLeadContacted(leadId: string) {
  return prisma.lead.update({
    where: { id: leadId },
    data: {
      status: "CONTACTED",
      updatedAt: new Date()
    }
  });
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
  range,
  maxRows
}: {
  tenantId: string;
  userId: string;
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
  assertConnected(
    integrations,
    "WHATSAPP_CLOUD",
    "WhatsApp Cloud API is not connected for this company."
  );
  assertConnected(
    integrations,
    "WHATSAPP_TEMPLATE_SETTINGS",
    TEMPLATE_SETTINGS_NOT_CONFIGURED_MESSAGE
  );
  assertConnected(integrations, "KNOWLEDGE_BASE", "Knowledge base is not connected for this company.");
  assertConnected(integrations, "AI_MODEL", "AI model is not connected for this company.");

  const mainTemplateMessageConfig = await loadTenantTemplateMessageConfig({
    tenantId,
    templatePurpose: "MAIN"
  });
  const template = mainTemplateMessageConfig.template;
  const sheetRange = range || "A:Z";
  await ensureGoogleSheetStatusColumn({
    config: sheetsConfig,
    range: sheetRange,
    defaultStatus: "new"
  });
  const sheetLeads = await readGoogleSheetLeads({
    config: sheetsConfig,
    range: sheetRange,
    maxRows: Math.min(Math.max(maxRows ?? 200, 1), 200)
  });

  const results = [];
  const sendGapMs = configuredLeadSendGapMs();
  let attemptedSends = 0;

  for (const sheetLead of sheetLeads) {
    const sheetStatus = normalizedSheetStatus(sheetLead.status);
    if (!shouldMessageSheetLead(sheetLead)) {
      results.push({
        phone: sheetLead.phone,
        status: "skipped",
        reason: `Sheet status is ${sheetStatus || "not new"}`,
        sheetStatus: sheetLead.status ?? null,
        rowNumber: sheetLead.rowNumber
      });
      continue;
    }

    const { contact, conversation } = await upsertLeadConversation({ tenantId, lead: sheetLead });
    const leadRecord = await prisma.lead.findFirst({
      where: { tenantId, contactId: contact.id },
      select: { id: true }
    });

    if (contact.optOut) {
      await safeMarkSheetLeadStatus({
        config: sheetsConfig,
        range: sheetRange,
        lead: sheetLead,
        status: "failure"
      });
      results.push({ phone: contact.phone, status: "skipped", reason: "Contact opted out", rowNumber: sheetLead.rowNumber });
      continue;
    }

    const deliveryLimit = await activeMetaDeliveryLimitForContact({
      tenantId,
      contactId: contact.id,
      customFields: contact.customFields
    });
    if (deliveryLimit) {
      const failureReason = metaDeliveryLimitReason(deliveryLimit);
      await safeMarkSheetLeadStatus({
        config: sheetsConfig,
        range: sheetRange,
        lead: sheetLead,
        status: META_DELIVERY_LIMIT_DISPLAY
      });
      results.push({
        phone: contact.phone,
        status: "META_DELIVERY_LIMITED",
        reason: failureReason,
        retryAfter: deliveryLimit.retryAfter,
        rowNumber: sheetLead.rowNumber,
        sheetStatus: sheetLead.status ?? null
      });
      continue;
    }

    if (await alreadySentTemplate({ tenantId, conversationId: conversation.id, templateId: template.id })) {
      if (leadRecord) {
        await markCrmLeadContacted(leadRecord.id);
      }
      const sheetUpdate = await safeMarkSheetLeadMessaged({ config: sheetsConfig, range: sheetRange, lead: sheetLead });
      results.push({
        phone: contact.phone,
        status: "skipped",
        reason: sheetUpdate.ok ? "Template already sent" : `Template already sent, but sheet update failed: ${sheetUpdate.error}`,
        rowNumber: sheetLead.rowNumber,
        sheetStatus: sheetLead.status ?? null
      });
      continue;
    }

    const leadInput = leadTemplateInput(sheetLead);
    if (attemptedSends > 0 && sendGapMs > 0) {
      await wait(sendGapMs);
    }
    attemptedSends += 1;
    const templateMessage = await sendTemplateMessage({
      tenantId,
      templatePurpose: "MAIN",
      to: contact.phone,
      lead: leadInput,
      config: mainTemplateMessageConfig
    });
    const { sendResult, templateConfig, variables } = templateMessage;
    const immediateDeliveryLimit =
      !sendResult.ok && isMetaDeliveryLimitError(sendResult.error)
        ? createMetaDeliveryLimit({ reason: sendResult.error })
        : null;
    const preview = templateMessage.body;
    const messageMetadata = {
      sentByUserId: userId,
      adapter: "lead-google-sheets-flow",
      templateName: template.name,
      templateLanguage: template.language,
      sheetRowNumber: sheetLead.rowNumber,
      sheetStatusColumnIndex: sheetLead.statusColumnIndex,
      sheetRange,
      leadSendGapMs: sendGapMs,
      variableMode: templateConfig.variableMode,
      variableMappings: templateConfig.variables,
      variables
    };
    const outbound = await createOutboundConversationMessage({
      tenantId,
      conversationId: conversation.id,
      type: "TEMPLATE",
      templateId: template.id ?? undefined,
      body: preview,
      whatsappMessageId: sendResult.whatsappMessageId,
      status: sendResult.ok ? "PENDING" : "FAILED",
      failureReason: sendResult.error ?? null,
      metadata: (immediateDeliveryLimit
        ? withMetaDeliveryLimitMetadata(messageMetadata, immediateDeliveryLimit)
        : messageMetadata) as Prisma.InputJsonObject
    });

    if (immediateDeliveryLimit) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          customFields: withContactMetaDeliveryLimit(
            contact.customFields,
            immediateDeliveryLimit,
            outbound.message.id
          ) as Prisma.InputJsonValue
        }
      });
      const failureReason = metaDeliveryLimitReason(immediateDeliveryLimit);
      await safeMarkSheetLeadStatus({
        config: sheetsConfig,
        range: sheetRange,
        lead: sheetLead,
        status: META_DELIVERY_LIMIT_DISPLAY
      });
    } else if (!sendResult.ok) {
      await safeMarkSheetLeadStatus({
        config: sheetsConfig,
        range: sheetRange,
        lead: sheetLead,
        status: "failure"
      });
    }

    await safeRecordUsage({
      tenantId,
      feature: "LEAD_MANAGEMENT",
      provider: "meta",
      eventType: sendResult.ok
        ? "lead_template.queued"
        : immediateDeliveryLimit
          ? "lead_template.meta_delivery_limited"
          : "lead_template.failed",
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
      status: sendResult.ok ? "sent" : immediateDeliveryLimit ? "META_DELIVERY_LIMITED" : "failed",
      reason: immediateDeliveryLimit ? metaDeliveryLimitReason(immediateDeliveryLimit) : (sendResult.error ?? null),
      retryAfter: immediateDeliveryLimit?.retryAfter,
      conversationId: conversation.id,
      messageId: outbound.message.id,
      whatsappMessageId: sendResult.whatsappMessageId ?? null
    });

    let sheetUpdate: Awaited<ReturnType<typeof safeMarkSheetLeadMessaged>> | null = null;
    if (sendResult.ok) {
      if (leadRecord) {
        await markCrmLeadContacted(leadRecord.id);
      }
      sheetUpdate = await safeMarkSheetLeadMessaged({ config: sheetsConfig, range: sheetRange, lead: sheetLead });
    }

    results[results.length - 1] = {
      ...results[results.length - 1],
      rowNumber: sheetLead.rowNumber,
      sheetStatus: sheetLead.status ?? null,
      sheetUpdated: sheetUpdate ? sheetUpdate.ok : false,
      reason:
        (immediateDeliveryLimit ? metaDeliveryLimitReason(immediateDeliveryLimit) : sendResult.error) ??
        (sheetUpdate && !sheetUpdate.ok ? `WhatsApp sent, but sheet update failed: ${sheetUpdate.error}` : null)
    };
  }

  await safeCreateAuditLog({
    actorUserId: userId,
    tenantId,
    action: "lead.google_sheet_flow_run",
    entityType: "Lead",
    newValue: {
      range: range || "A:Z",
      maxRows: maxRows ?? 200,
      scanned: sheetLeads.length,
      sent: results.filter((result) => result.status === "sent").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      deliveryLimited: results.filter((result) => result.status === "META_DELIVERY_LIMITED").length
    }
  });

  return {
    scanned: sheetLeads.length,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    deliveryLimited: results.filter((result) => result.status === "META_DELIVERY_LIMITED").length,
    results
  };
}
