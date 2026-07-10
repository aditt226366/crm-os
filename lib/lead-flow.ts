import { Prisma, type ConversationSource, type IntegrationType, type LeadStatus, type LeadTemperature } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { safeCreateAuditLog } from "@/lib/audit";
import { resolveContactForPhone } from "@/lib/contact-identity";
import { INTEGRATION_DEFINITIONS, type FeatureKey } from "@/lib/constants";
import {
  CRM_LEADS_RANGE,
  DEFAULT_LEAD_SHEET_RANGE,
  ensureGoogleSheetStatusColumn,
  googleSheetTabRange,
  isCrmLeadsRange,
  readGoogleSheetLeads,
  updateGoogleSheetLeadStatuses,
  type SheetLead
} from "@/lib/google-sheets-leads";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";
import { recordUsage } from "@/lib/usage";
import { emitTenantEvent } from "@/lib/realtime";
import { type WhatsAppTemplateLead } from "@/lib/whatsapp-cloud";
import { templateVariableConfig } from "@/lib/whatsapp-template-config";
import {
  enrollImportedLeadInSourceCampaign,
  runDueSourceCampaignSteps,
  type SourceCampaignRunResult
} from "@/lib/source-campaigns";
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sheetLeadMetadata(lead: SheetLead): Prisma.InputJsonObject {
  const googleSheet = {
    source_sheet: lead.sourceSheet,
    sourceSheet: lead.sourceSheet,
    source_row: lead.sourceRow,
    sourceRow: lead.sourceRow,
    rowNumber: lead.rowNumber,
    row: lead.row
  };

  return {
    source_sheet: lead.sourceSheet,
    source_row: lead.sourceRow,
    googleSheet
  };
}

function mergeSheetLeadMetadata(existing: unknown, lead: SheetLead): Prisma.InputJsonObject {
  const current = asRecord(existing);
  const currentGoogleSheet = asRecord(current.googleSheet);

  return {
    ...current,
    source_sheet: lead.sourceSheet,
    source_row: lead.sourceRow,
    googleSheet: {
      ...currentGoogleSheet,
      source_sheet: lead.sourceSheet,
      sourceSheet: lead.sourceSheet,
      source_row: lead.sourceRow,
      sourceRow: lead.sourceRow,
      rowNumber: lead.rowNumber,
      row: lead.row
    }
  };
}

function sourceSheetFromMetadata(metadata: unknown) {
  const record = asRecord(metadata);
  const googleSheet = asRecord(record.googleSheet);
  const value = record.source_sheet ?? googleSheet.source_sheet ?? googleSheet.sourceSheet;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourceWritebackSheetName(lead: SheetLead) {
  const sourceSheet = lead.sourceSheet?.trim();
  if (!sourceSheet) return null;
  // Write status back to the originating source tab for ANY lead that carries a
  // source_sheet — not only registered campaign sheets. The one tab we must never
  // write to is crm_leads: it is produced by a spill array formula that owns its
  // output cells, so writing there throws "Array result was not expanded ...".
  if (isCrmLeadsRange(googleSheetTabRange(sourceSheet))) return null;
  return sourceSheet;
}

function sourceWritebackTarget(lead: SheetLead) {
  const sourceSheet = sourceWritebackSheetName(lead);
  if (!sourceSheet || !lead.sourceRow) return null;
  return {
    range: googleSheetTabRange(sourceSheet),
    rowNumber: lead.sourceRow,
    sourceSheet,
    sourceRow: lead.sourceRow
  };
}

function isMissingCrmLeadsTabError(error: unknown) {
  return (
    error instanceof ApiError &&
    error.code === "GOOGLE_SHEETS_READ_FAILED" &&
    /unable to parse range|cannot find|not found|range/i.test(error.message)
  );
}

async function readSheetLeadsForFlow({
  config,
  maxRows
}: {
  config: IntegrationConfig;
  maxRows: number;
}) {
  try {
    return {
      range: CRM_LEADS_RANGE,
      readOnlyMaster: true,
      leads: await readGoogleSheetLeads({
        config,
        range: CRM_LEADS_RANGE,
        maxRows
      })
    };
  } catch (error) {
    if (!isMissingCrmLeadsTabError(error)) {
      throw error;
    }
  }

  await ensureGoogleSheetStatusColumn({
    config,
    range: DEFAULT_LEAD_SHEET_RANGE,
    defaultStatus: "new"
  });
  return {
    range: DEFAULT_LEAD_SHEET_RANGE,
    readOnlyMaster: false,
    leads: await readGoogleSheetLeads({
      config,
      range: DEFAULT_LEAD_SHEET_RANGE,
      maxRows
    })
  };
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
  status,
  statusColumnCache
}: {
  config: IntegrationConfig;
  range: string;
  lead: SheetLead;
  status: string;
  statusColumnCache: Map<string, number | null>;
}) {
  const sourceTarget = sourceWritebackTarget(lead);
  const targetRange = sourceTarget?.range ?? range;
  const targetRowNumber = sourceTarget?.rowNumber ?? lead.rowNumber;

  if (!sourceTarget && isCrmLeadsRange(range)) {
    return {
      ok: false,
      skipped: false as const,
      error:
        "Missing source_sheet/source_row in crm_leads; status write-back skipped — check the crm_leads formula columns. Lead status is still tracked in the CRM."
    };
  }

  let statusColumnIndex = sourceTarget ? statusColumnCache.get(targetRange) : lead.statusColumnIndex;
  if (statusColumnIndex === undefined || statusColumnIndex === null) {
    try {
      const ensured = await ensureGoogleSheetStatusColumn({
        config,
        range: targetRange,
        defaultStatus: "new"
      });
      statusColumnIndex = ensured.statusColumnIndex;
      statusColumnCache.set(targetRange, statusColumnIndex);
    } catch (error) {
      console.error("[lead-flow.sheets] status column lookup failed", error instanceof Error ? error.message : String(error));
      return {
        ok: false,
        skipped: false as const,
        error: error instanceof Error ? error.message : "Google Sheets status column lookup failed"
      };
    }
  }

  if (statusColumnIndex === null) {
    return { ok: true, skipped: true as const };
  }

  try {
    await updateGoogleSheetLeadStatuses({
      config,
      range: targetRange,
      updates: [{ rowNumber: targetRowNumber, statusColumnIndex, status }]
    });
    return { ok: true, skipped: false as const, targetRange, targetRowNumber, statusColumnIndex };
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

type LeadFlowSummaryOptions = {
  limit?: number;
  cursor?: string | null;
  search?: string | null;
  status?: string | null;
  leadTemperature?: string | null;
  source?: string | null;
};

export async function leadFlowSummary(tenantId: string, options: LeadFlowSummaryOptions = {}) {
  await syncConfiguredApprovedTemplate(tenantId);
  const integrations = await currentFlowIntegrations(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 100);
  const search = options.search?.trim().slice(0, 80);
  const where: Prisma.LeadWhereInput = { tenantId };
  const and: Prisma.LeadWhereInput[] = [];

  if (options.status) {
    and.push({ status: options.status as LeadStatus });
  }
  if (options.leadTemperature) {
    and.push({ temperature: options.leadTemperature as LeadTemperature });
  }
  if (options.source) {
    and.push({ source: options.source as ConversationSource });
  }
  if (search) {
    and.push({
      OR: [
        { productInterest: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
        { contact: { is: { name: { contains: search, mode: "insensitive" } } } },
        { contact: { is: { phone: { contains: search, mode: "insensitive" } } } },
        { contact: { is: { phoneNormalized: { contains: search, mode: "insensitive" } } } },
        { contact: { is: { waId: { contains: search, mode: "insensitive" } } } },
        { contact: { is: { last10: { contains: search, mode: "insensitive" } } } }
      ]
    });
  }
  if (and.length) {
    where.AND = and;
  }

  const templates = await prisma.whatsAppTemplate.findMany({
    where: { tenantId, status: "APPROVED" },
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      status: true,
      body: true,
      updatedAt: true
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 20
  });
  const leads = await prisma.lead.findMany({
    where,
    select: {
      id: true,
      status: true,
      temperature: true,
      source: true,
      metadata: true,
      productInterest: true,
      updatedAt: true,
      createdAt: true,
      contact: {
        select: {
          id: true,
          name: true,
          phone: true,
          phoneNormalized: true,
          optOut: true,
          customerReplyCount: true,
          totalMessageCount: true,
          lastMessageAt: true,
          lastContactedAt: true
        }
      },
      conversation: {
        select: {
          id: true,
          status: true,
          humanTakeover: true,
          lastMessageText: true,
          lastMessageAt: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              metadata: true,
              failureReason: true
            }
          }
        }
      },
      sourceAutomationEnrollments: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          status: true,
          currentStep: true,
          nextStepNumber: true,
          nextSendAt: true,
          lastDeliveryStatus: true,
          campaign: {
            select: {
              key: true,
              name: true
            }
          }
        }
      }
    },
    orderBy: { updatedAt: "desc" },
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    take: limit + 1
  });
  const page = leads.slice(0, limit);
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
    leads: page.map((lead) => {
      const campaignEnrollment = lead.sourceAutomationEnrollments[0] ?? null;
      return {
        id: lead.id,
        status: lead.status,
        temperature: lead.temperature,
        source: lead.source,
        sourceSheet: sourceSheetFromMetadata(lead.metadata),
        productInterest: lead.productInterest,
        updatedAt: lead.updatedAt.toISOString(),
        createdAt: lead.createdAt.toISOString(),
        campaign: campaignEnrollment
          ? {
              key: campaignEnrollment.campaign.key,
              name: campaignEnrollment.campaign.name,
              status: campaignEnrollment.status,
              currentStep: campaignEnrollment.currentStep,
              nextStepNumber: campaignEnrollment.nextStepNumber,
              nextSendAt: campaignEnrollment.nextSendAt?.toISOString() ?? null,
              deliveryStatus: campaignEnrollment.lastDeliveryStatus
            }
          : null,
        contact: {
          id: lead.contact.id,
          name: lead.contact.name,
          phone: lead.contact.phone,
          phoneNormalized: lead.contact.phoneNormalized,
          optOut: lead.contact.optOut,
          customerReplyCount: lead.contact.customerReplyCount,
          totalMessageCount: lead.contact.totalMessageCount,
          lastCustomerMessageAt: lead.contact.lastMessageAt?.toISOString() ?? null,
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
      };
    }),
    pagination: {
      limit,
      hasMore: leads.length > limit,
      nextCursor: leads.length > limit ? page[page.length - 1]?.id ?? null : null
    }
  };
}

async function upsertLeadConversation({ tenantId, lead }: { tenantId: string; lead: SheetLead }) {
  const now = new Date();
  const resolved = await resolveContactForPhone({
    tenantId,
    phone: lead.phone,
    name: lead.name,
    source: "GOOGLE_SHEET",
    tags: ["google-sheet"],
    customFields: {
      googleSheet: {
        source_sheet: lead.sourceSheet,
        sourceSheet: lead.sourceSheet,
        source_row: lead.sourceRow,
        sourceRow: lead.sourceRow,
        rowNumber: lead.rowNumber,
        row: lead.row
      }
    }
  });
  const contact = await prisma.contact.update({
    where: { id: resolved.contact.id },
    data: {
      lastMessageAt: now
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
    where: { tenantId, contactId: contact.id },
    select: {
      id: true,
      status: true,
      metadata: true
    }
  });

  const crmLead = existingLead
    ? await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          conversationId: conversation.id,
          source: "GOOGLE_SHEET",
          status: existingLead.status,
          metadata: mergeSheetLeadMetadata(existingLead.metadata, lead),
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
          status: "NEW",
          metadata: sheetLeadMetadata(lead)
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
  // When we have a concrete template id, dedupe on it. When we don't (no local
  // WhatsAppTemplate row resolved yet), fall back to "any MAIN template already
  // sent on this conversation" so a lead is never messaged twice across sheet
  // sync runs — the CRM DB, not the sheet status, is the real dedupe source.
  const existing = await prisma.message.findFirst({
    where: {
      tenantId,
      conversationId,
      direction: "OUTBOUND",
      type: "TEMPLATE",
      status: { in: ["PENDING", "SENT", "DELIVERED", "READ"] },
      ...(templateId ? { templateId } : {})
    },
    select: { id: true }
  });

  return Boolean(existing);
}

export async function runGoogleSheetLeadFlow({
  tenantId,
  userId,
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
  const sheetSource = await readSheetLeadsForFlow({
    config: sheetsConfig,
    maxRows: Math.min(Math.max(maxRows ?? 200, 1), 200)
  });
  const sheetRange = sheetSource.range;
  const sheetLeads = sheetSource.leads;
  const statusColumnCache = new Map<string, number | null>();

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
        sourceSheet: sheetLead.sourceSheet,
        rowNumber: sheetLead.rowNumber
      });
      continue;
    }

    // When reading from the crm_leads master, a lead may be missing
    // source_sheet/source_row (e.g. the formula columns are misconfigured). We
    // still process the lead — the CRM DB is the source of truth for lead and
    // campaign status — and simply skip the sheet write-back with a specific,
    // actionable reason. We never fall back to writing status into crm_leads,
    // which is spill-formula output and would throw a spill/overwrite error.
    const writebackTarget = sourceWritebackTarget(sheetLead);

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
        status: "failure",
        statusColumnCache
      });
      results.push({
        phone: contact.phone,
        status: "skipped",
        reason: "Contact opted out",
        sourceSheet: sheetLead.sourceSheet,
        rowNumber: sheetLead.rowNumber
      });
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
        status: META_DELIVERY_LIMIT_DISPLAY,
        statusColumnCache
      });
      results.push({
        phone: contact.phone,
        status: "META_DELIVERY_LIMITED",
        reason: failureReason,
        retryAfter: deliveryLimit.retryAfter,
        sourceSheet: sheetLead.sourceSheet,
        rowNumber: sheetLead.rowNumber,
        sheetStatus: sheetLead.status ?? null
      });
      continue;
    }

    const sourceCampaignEnrollment = await enrollImportedLeadInSourceCampaign({
      tenantId,
      leadId: leadRecord?.id,
      contactId: contact.id,
      conversationId: conversation.id,
      sourceSheet: sheetLead.sourceSheet
    });
    if (sourceCampaignEnrollment) {
      if (attemptedSends > 0 && sendGapMs > 0) {
        await wait(sendGapMs);
      }
      attemptedSends += 1;

      const campaignRun: SourceCampaignRunResult = await runDueSourceCampaignSteps({
        tenantId,
        userId,
        enrollmentId: sourceCampaignEnrollment.enrollment.id,
        maxSends: 1,
        endpoint: "/api/app/leads"
      });
      const campaignResult = campaignRun.results[0] ?? null;
      const campaignSent =
        campaignResult?.status === "sent" ||
        campaignResult?.status === "completed" ||
        (!campaignResult && sourceCampaignEnrollment.enrollment.currentStep > 0);
      const campaignFailed = campaignResult?.status === "failed";
      let sheetUpdate: Awaited<ReturnType<typeof safeMarkSheetLeadMessaged>> | null = null;

      if (campaignSent) {
        if (leadRecord) {
          await markCrmLeadContacted(leadRecord.id);
        }
        sheetUpdate = await safeMarkSheetLeadMessaged({
          config: sheetsConfig,
          range: sheetRange,
          lead: sheetLead,
          statusColumnCache
        });
      } else if (campaignFailed) {
        await safeMarkSheetLeadStatus({
          config: sheetsConfig,
          range: sheetRange,
          lead: sheetLead,
          status: "failure",
          statusColumnCache
        });
      }

      results.push({
        phone: contact.phone,
        status: campaignSent ? "sent" : campaignFailed ? "failed" : "skipped",
        reason:
          campaignResult?.reason ??
          (campaignSent
            ? null
            : sourceCampaignEnrollment.enrollment.status === "ACTIVE"
              ? "Campaign already enrolled; no due step right now."
              : `Campaign enrollment is ${sourceCampaignEnrollment.enrollment.status}`),
        conversationId: conversation.id,
        messageId: campaignResult?.messageId ?? null,
        whatsappMessageId: campaignResult?.whatsappMessageId ?? null,
        campaignKey: sourceCampaignEnrollment.campaign.key,
        campaignStatus: sourceCampaignEnrollment.enrollment.status,
        campaignStep: campaignResult?.stepNumber ?? sourceCampaignEnrollment.enrollment.currentStep,
        sourceSheet: sheetLead.sourceSheet,
        rowNumber: sheetLead.rowNumber,
        sheetStatus: sheetLead.status ?? null,
        sheetUpdated: sheetUpdate ? sheetUpdate.ok : false
      });
      continue;
    }

    if (await alreadySentTemplate({ tenantId, conversationId: conversation.id, templateId: template.id })) {
      if (leadRecord) {
        await markCrmLeadContacted(leadRecord.id);
      }
      const sheetUpdate = await safeMarkSheetLeadMessaged({ config: sheetsConfig, range: sheetRange, lead: sheetLead, statusColumnCache });
      results.push({
        phone: contact.phone,
        status: "skipped",
        reason: sheetUpdate.ok ? "Template already sent" : `Template already sent, but sheet update failed: ${sheetUpdate.error}`,
        sourceSheet: sheetLead.sourceSheet,
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
      sheetSourceRow: sheetLead.sourceRow,
      sheetStatusColumnIndex: writebackTarget ? null : sheetLead.statusColumnIndex,
      sheetRange,
      sheetSourceSheet: sheetLead.sourceSheet,
      sheetStatusRange: writebackTarget?.range ?? (isCrmLeadsRange(sheetRange) ? null : sheetRange),
      sheetStatusRowNumber: writebackTarget?.rowNumber ?? (isCrmLeadsRange(sheetRange) ? null : sheetLead.rowNumber),
      source_sheet: sheetLead.sourceSheet,
      source_row: sheetLead.sourceRow,
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
        status: META_DELIVERY_LIMIT_DISPLAY,
        statusColumnCache
      });
    } else if (!sendResult.ok) {
      await safeMarkSheetLeadStatus({
        config: sheetsConfig,
        range: sheetRange,
        lead: sheetLead,
        status: "failure",
        statusColumnCache
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
      metadata: {
        messageId: outbound.message.id,
        templateName: template.name,
        sheetRange,
        sheetRowNumber: sheetLead.rowNumber,
        sheetSourceRow: sheetLead.sourceRow,
        source_sheet: sheetLead.sourceSheet,
        source_row: sheetLead.sourceRow
      }
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
      whatsappMessageId: sendResult.whatsappMessageId ?? null,
      sourceSheet: sheetLead.sourceSheet
    });

    let sheetUpdate: Awaited<ReturnType<typeof safeMarkSheetLeadMessaged>> | null = null;
    if (sendResult.ok) {
      if (leadRecord) {
        await markCrmLeadContacted(leadRecord.id);
      }
      sheetUpdate = await safeMarkSheetLeadMessaged({ config: sheetsConfig, range: sheetRange, lead: sheetLead, statusColumnCache });
    }

    results[results.length - 1] = {
      ...results[results.length - 1],
      rowNumber: sheetLead.rowNumber,
      sheetStatus: sheetLead.status ?? null,
      sourceSheet: sheetLead.sourceSheet,
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
      range: sheetRange,
      readOnlyMaster: sheetSource.readOnlyMaster,
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
