import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";
import {
  activeMetaDeliveryLimit,
  createMetaDeliveryLimit,
  isMetaDeliveryLimitError,
  metaDeliveryLimitReason,
  withContactMetaDeliveryLimit,
  withMetaDeliveryLimitMetadata
} from "@/lib/meta-delivery-limit";
import { prisma } from "@/lib/prisma";
import { emitTenantEvent } from "@/lib/realtime";
import { ensureSourceCampaignSchema } from "@/lib/source-campaign-schema";
import {
  canonicalSheetName,
  loadSheetCampaignConfig,
  sheetCampaignForSheet,
  sheetCampaignKey,
  type SheetCampaign,
  type SheetCampaignConfig,
  type SheetCampaignTemplate
} from "@/lib/sheet-campaign-config";
import { recordUsage } from "@/lib/usage";
import {
  renderTemplateBody,
  resolveWhatsAppTemplateVariables,
  sendWhatsAppTemplateMessage,
  type WhatsAppTemplateLead
} from "@/lib/whatsapp-cloud";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SEND_GAP_MS = 6000;
const SOURCE_CAMPAIGN_ADAPTER = "source-based-campaign";
// A FAILED enrollment (e.g. a rejected template send) is retried on the next
// import, but at most once per this window so a permanently-failing lead can't
// re-send on every scheduler tick.
const FAILED_ENROLLMENT_RETRY_MS = 10 * 60 * 1000;

type CampaignEnrollmentStatus = "ACTIVE" | "COMPLETED" | "STOPPED" | "FAILED";
export type CampaignDeliveryStatus = "SENDING" | "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

type DeliveryRecord = {
  campaignId: string;
  stepNumber: number;
  scheduledFor: string;
  sentAt: string | null;
  deliveryStatus: CampaignDeliveryStatus;
  messageId?: string | null;
  whatsappMessageId?: string | null;
  error?: string | null;
};

type DueEnrollment = Prisma.AutomationCampaignEnrollmentGetPayload<{
  include: {
    campaign: { include: { steps: true } };
    contact: true;
    conversation: true;
  };
}>;

export type SourceCampaignRunResult = {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  stopped: number;
  completed: number;
  results: Array<{
    enrollmentId: string;
    campaignKey: string;
    phone: string;
    status: "sent" | "failed" | "skipped" | "stopped" | "completed";
    stepNumber?: number;
    reason?: string | null;
    messageId?: string | null;
    whatsappMessageId?: string | null;
  }>;
};

function configuredSendGapMs() {
  const value = Number(process.env.SOURCE_CAMPAIGN_SEND_GAP_MS);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_SEND_GAP_MS;
  return Math.min(Math.round(value), 60_000);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function campaignLead(contact: { name: string | null; phone: string }): WhatsAppTemplateLead {
  return { name: contact.name, phone: contact.phone };
}

/**
 * Inbox preview for a template message. Uses the locally synced template body
 * (rendered with the resolved variables) when available, otherwise a compact
 * placeholder. The actual WhatsApp send always uses the approved template.
 */
async function resolveTemplatePreviewBody(
  tenantId: string,
  template: SheetCampaignTemplate,
  lead: WhatsAppTemplateLead
) {
  const variables = resolveWhatsAppTemplateVariables({ variables: template.variables, lead });
  const local = await prisma.whatsAppTemplate.findFirst({
    where: { tenantId, name: template.name, language: template.language },
    select: { body: true }
  });
  if (local?.body) {
    return renderTemplateBody(local.body, variables);
  }
  return `Template: ${template.name}`;
}

function deliveryRecords(value: unknown): DeliveryRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is DeliveryRecord => {
        if (!item || typeof item !== "object") return false;
        const record = item as Partial<DeliveryRecord>;
        return typeof record.campaignId === "string" && typeof record.stepNumber === "number";
      })
    : [];
}

function upsertDeliveryRecord(records: DeliveryRecord[], nextRecord: DeliveryRecord) {
  const others = records.filter((record) => record.stepNumber !== nextRecord.stepNumber);
  return [...others, nextRecord].sort((left, right) => left.stepNumber - right.stepNumber);
}

function nonFailedDeliveryForStep(records: DeliveryRecord[], stepNumber: number) {
  return records.find((record) => record.stepNumber === stepNumber && record.deliveryStatus !== "FAILED") ?? null;
}

function nextStep(enrollment: DueEnrollment, stepNumber: number) {
  return [...enrollment.campaign.steps].sort((left, right) => left.stepNumber - right.stepNumber).find((step) => step.stepNumber > stepNumber) ?? null;
}

function scheduledForStep(enrollment: Pick<DueEnrollment, "campaignStartTime">, delayDays: number) {
  return new Date(enrollment.campaignStartTime.getTime() + delayDays * DAY_MS);
}

function metadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function metadataNumber(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numberValue) ? numberValue : null;
}

async function connectedWhatsAppConfig(tenantId: string): Promise<IntegrationConfig> {
  const integration = await prisma.integration.findUnique({
    where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } },
    select: { status: true, encryptedConfig: true }
  });

  if (integration?.status !== "CONNECTED") {
    throw new ApiError(409, "WHATSAPP_CONFIG_MISSING", "WhatsApp Cloud API is not connected for this company.");
  }

  return readEncryptedConfig(integration.encryptedConfig);
}

async function safeUsage(input: {
  tenantId: string;
  eventType: string;
  endpoint: string;
  status: string;
  metadata?: unknown;
}) {
  try {
    await recordUsage({
      tenantId: input.tenantId,
      feature: "LEAD_MANAGEMENT",
      provider: "meta",
      eventType: input.eventType,
      endpoint: input.endpoint,
      units: 1,
      cost: input.status === "SUCCESS" ? 0.006 : 0,
      status: input.status,
      metadata: input.metadata
    });
  } catch (error) {
    console.error("[source-campaign.usage] failed", error instanceof Error ? error.message : String(error));
  }
}

async function ensureCampaignForTenant(tenantId: string, sheetCampaign: SheetCampaign) {
  await ensureSourceCampaignSchema();
  const key = sheetCampaignKey(sheetCampaign.sheetName);
  const campaign = await prisma.automationCampaign.upsert({
    where: {
      tenantId_key: {
        tenantId,
        key
      }
    },
    create: {
      tenantId,
      key,
      name: sheetCampaign.sheetName,
      sourceSheet: sheetCampaign.sheetName,
      status: "ACTIVE",
      metadata: {
        sourceSheet: sheetCampaign.sheetName,
        managedBy: "sheet-campaign-engine"
      } as Prisma.InputJsonObject
    },
    update: {
      name: sheetCampaign.sheetName,
      sourceSheet: sheetCampaign.sheetName,
      status: "ACTIVE",
      metadata: {
        sourceSheet: sheetCampaign.sheetName,
        managedBy: "sheet-campaign-engine"
      } as Prisma.InputJsonObject
    }
  });

  // Steps are 1-indexed and mirror the configured template order. The step
  // `body` holds the template name for display; the actual template descriptor
  // (language/variables) is resolved from the tenant config at send time.
  for (const [index, template] of sheetCampaign.templates.entries()) {
    const stepNumber = index + 1;
    await prisma.automationCampaignStep.upsert({
      where: {
        campaignId_stepNumber: {
          campaignId: campaign.id,
          stepNumber
        }
      },
      create: {
        campaignId: campaign.id,
        stepNumber,
        delayDays: template.delayDays,
        body: template.name,
        sendCondition: stepNumber === 1 ? "IMMEDIATE" : "NO_INBOUND_REPLY_SINCE_START"
      },
      update: {
        delayDays: template.delayDays,
        body: template.name,
        sendCondition: stepNumber === 1 ? "IMMEDIATE" : "NO_INBOUND_REPLY_SINCE_START"
      }
    });
  }

  // Drop any steps beyond the configured template count (config was shortened).
  await prisma.automationCampaignStep.deleteMany({
    where: { campaignId: campaign.id, stepNumber: { gt: sheetCampaign.templates.length } }
  });

  return prisma.automationCampaign.findUniqueOrThrow({
    where: { id: campaign.id },
    include: { steps: true }
  });
}

export async function enrollImportedLeadInSourceCampaign({
  tenantId,
  leadId,
  contactId,
  conversationId,
  sourceSheet,
  sheetConfig,
  forceRetry = false
}: {
  tenantId: string;
  leadId?: string | null;
  contactId: string;
  conversationId?: string | null;
  sourceSheet?: string | null;
  sheetConfig?: SheetCampaignConfig | null;
  // Ignore the FAILED-retry cooldown (used for an explicit manual "resend").
  forceRetry?: boolean;
}) {
  const config = sheetConfig ?? (await loadSheetCampaignConfig(tenantId));
  const sheetCampaign = sheetCampaignForSheet(config, sourceSheet);
  if (!sheetCampaign) return null;

  const campaign = await ensureCampaignForTenant(tenantId, sheetCampaign);
  const canonicalSourceSheet = canonicalSheetName(config, sourceSheet) ?? sheetCampaign.sheetName;
  const existing = await prisma.automationCampaignEnrollment.findUnique({
    where: {
      campaignId_contactId: {
        campaignId: campaign.id,
        contactId
      }
    },
    include: { campaign: true }
  });

  if (existing) {
    // If the enrollment previously FAILED (most often a rejected template send
    // whose config has since been corrected), reset it to ACTIVE so the next
    // run retries the step that failed. Gated by a cooldown so a lead that keeps
    // failing does not resend on every scheduler tick.
    const lastAttempt = existing.lastSentAt ?? null;
    const retryFailed =
      existing.status === "FAILED" &&
      (forceRetry || !lastAttempt || Date.now() - lastAttempt.getTime() >= FAILED_ENROLLMENT_RETRY_MS);
    const enrollment = await prisma.automationCampaignEnrollment.update({
      where: { id: existing.id },
      data: {
        leadId: leadId ?? existing.leadId,
        conversationId: conversationId ?? existing.conversationId,
        sourceSheet: canonicalSourceSheet,
        ...(retryFailed
          ? {
              status: "ACTIVE",
              nextStepNumber: existing.currentStep > 0 ? existing.currentStep : 1,
              nextSendAt: new Date(),
              failureReason: null,
              lastDeliveryStatus: null
            }
          : {})
      },
      include: { campaign: true }
    });
    return { campaign, enrollment, created: false };
  }

  const startTime = new Date();
  // Honor the delay column for the FIRST step too, so it is authoritative for
  // every step: delay 0 => send immediately (nextSendAt = now), delay 1 => 1 day
  // after enrollment, and so on. campaignStartTime stays the anchor that every
  // later step's delay is measured from (scheduledForStep).
  const firstStep = [...campaign.steps].sort((a, b) => a.stepNumber - b.stepNumber)[0];
  const firstDelayDays = Math.max(0, firstStep?.delayDays ?? 0);
  const firstSendAt = new Date(startTime.getTime() + firstDelayDays * DAY_MS);
  const enrollment = await prisma.automationCampaignEnrollment.create({
    data: {
      tenantId,
      campaignId: campaign.id,
      leadId: leadId ?? null,
      contactId,
      conversationId: conversationId ?? null,
      sourceSheet: canonicalSourceSheet,
      status: "ACTIVE",
      currentStep: 0,
      nextStepNumber: 1,
      nextSendAt: firstSendAt,
      campaignStartTime: startTime,
      stepDeliveries: [] as Prisma.InputJsonArray
    },
    include: { campaign: true }
  });

  return { campaign, enrollment, created: true };
}

async function latestInboundForEnrollment(enrollment: DueEnrollment) {
  return prisma.message.findFirst({
    where: {
      tenantId: enrollment.tenantId,
      contactId: enrollment.contactId,
      direction: "INBOUND"
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true }
  });
}

async function stopEnrollment({
  enrollment,
  reason,
  lastInboundMessageAt
}: {
  enrollment: DueEnrollment;
  reason: string;
  lastInboundMessageAt?: Date | null;
}) {
  await prisma.automationCampaignEnrollment.update({
    where: { id: enrollment.id },
    data: {
      status: "STOPPED",
      nextStepNumber: null,
      nextSendAt: null,
      stoppedAt: new Date(),
      stoppedReason: reason,
      lastInboundMessageAt: lastInboundMessageAt ?? enrollment.lastInboundMessageAt
    }
  });
}

async function failEnrollment({
  enrollment,
  reason,
  records
}: {
  enrollment: DueEnrollment;
  reason: string;
  records?: DeliveryRecord[];
}) {
  await prisma.automationCampaignEnrollment.update({
    where: { id: enrollment.id },
    data: {
      status: "FAILED",
      nextStepNumber: null,
      nextSendAt: null,
      lastDeliveryStatus: "FAILED",
      failureReason: reason,
      ...(records ? { stepDeliveries: records as unknown as Prisma.InputJsonArray } : {})
    }
  });
}

async function sendEnrollmentStep({
  enrollment,
  stepNumber,
  userId,
  whatsappConfig,
  sheetConfig,
  endpoint
}: {
  enrollment: DueEnrollment;
  stepNumber: number;
  userId: string;
  whatsappConfig: IntegrationConfig;
  sheetConfig: SheetCampaignConfig | null;
  endpoint: string;
}): Promise<SourceCampaignRunResult["results"][number]> {
  const step = enrollment.campaign.steps.find((item) => item.stepNumber === stepNumber);
  if (!step) {
    await failEnrollment({ enrollment, reason: "Campaign step is missing." });
    return {
      enrollmentId: enrollment.id,
      campaignKey: enrollment.campaign.key,
      phone: enrollment.contact.phone,
      status: "failed",
      reason: "Campaign step is missing."
    };
  }

  // Resolve the approved template for this sheet + step from the tenant config.
  // Sending an approved template (not free text) is what lets a cold Google-Sheet
  // lead be messaged at all, and passing the variable mapping fills {{1}} etc.
  const sheetCampaign = sheetCampaignForSheet(sheetConfig, enrollment.sourceSheet);
  const template: SheetCampaignTemplate | null = sheetCampaign?.templates[stepNumber - 1] ?? null;
  if (!template) {
    const reason =
      "No approved template is configured for this sheet/step in Broadcast & Campaign Templates.";
    await failEnrollment({ enrollment, reason });
    return {
      enrollmentId: enrollment.id,
      campaignKey: enrollment.campaign.key,
      phone: enrollment.contact.phone,
      status: "failed",
      stepNumber,
      reason
    };
  }

  const latestInbound = await latestInboundForEnrollment(enrollment);
  if (latestInbound && latestInbound.createdAt >= enrollment.campaignStartTime) {
    await stopEnrollment({ enrollment, reason: "customer_reply", lastInboundMessageAt: latestInbound.createdAt });
    return {
      enrollmentId: enrollment.id,
      campaignKey: enrollment.campaign.key,
      phone: enrollment.contact.phone,
      status: "stopped",
      stepNumber,
      reason: "Customer replied after campaign start."
    };
  }

  if (enrollment.contact.optOut || !enrollment.contact.optIn) {
    await stopEnrollment({ enrollment, reason: "contact_opted_out" });
    return {
      enrollmentId: enrollment.id,
      campaignKey: enrollment.campaign.key,
      phone: enrollment.contact.phone,
      status: "stopped",
      stepNumber,
      reason: "Contact opted out."
    };
  }

  const deliveryLimit = activeMetaDeliveryLimit(enrollment.contact.customFields);
  if (deliveryLimit) {
    const reason = metaDeliveryLimitReason(deliveryLimit);
    await failEnrollment({ enrollment, reason });
    return {
      enrollmentId: enrollment.id,
      campaignKey: enrollment.campaign.key,
      phone: enrollment.contact.phone,
      status: "failed",
      stepNumber,
      reason
    };
  }

  const records = deliveryRecords(enrollment.stepDeliveries);
  const existingDelivery = nonFailedDeliveryForStep(records, stepNumber);
  if (existingDelivery) {
    return {
      enrollmentId: enrollment.id,
      campaignKey: enrollment.campaign.key,
      phone: enrollment.contact.phone,
      status: "skipped",
      stepNumber,
      reason: "Campaign step already has a non-failed delivery record."
    };
  }

  const scheduledFor = enrollment.nextSendAt ?? scheduledForStep(enrollment, step.delayDays);
  const sendingRecord: DeliveryRecord = {
    campaignId: enrollment.campaignId,
    stepNumber,
    scheduledFor: scheduledFor.toISOString(),
    sentAt: null,
    deliveryStatus: "SENDING",
    messageId: null,
    whatsappMessageId: null,
    error: null
  };
  const sendingRecords = upsertDeliveryRecord(records, sendingRecord);
  const claim = await prisma.automationCampaignEnrollment.updateMany({
    where: {
      id: enrollment.id,
      status: "ACTIVE",
      nextStepNumber: stepNumber,
      nextSendAt: { lte: new Date() }
    },
    data: {
      currentStep: stepNumber,
      lastScheduledFor: scheduledFor,
      lastDeliveryStatus: "SENDING",
      stepDeliveries: sendingRecords as unknown as Prisma.InputJsonArray
    }
  });
  if (!claim.count) {
    return {
      enrollmentId: enrollment.id,
      campaignKey: enrollment.campaign.key,
      phone: enrollment.contact.phone,
      status: "skipped",
      stepNumber,
      reason: "Campaign step was already claimed."
    };
  }

  const lead = campaignLead(enrollment.contact);
  const body = await resolveTemplatePreviewBody(enrollment.tenantId, template, lead);
  const sendResult = await sendWhatsAppTemplateMessage({
    config: whatsappConfig,
    to: enrollment.contact.phone,
    templateName: template.name,
    language: template.language,
    variableMode: template.variableMode,
    variableMappings: template.variables,
    headerImageUrl: template.headerImageUrl,
    lead
  });
  const metaLimit =
    !sendResult.ok && isMetaDeliveryLimitError(sendResult.error)
      ? createMetaDeliveryLimit({ reason: sendResult.error })
      : null;
  const deliveryStatus: CampaignDeliveryStatus = sendResult.ok ? "PENDING" : "FAILED";
  const messageMetadata = {
    adapter: SOURCE_CAMPAIGN_ADAPTER,
    sentByUserId: userId,
    campaignId: enrollment.campaignId,
    campaignKey: enrollment.campaign.key,
    campaignEnrollmentId: enrollment.id,
    stepNumber,
    scheduledFor: scheduledFor.toISOString(),
    source_sheet: enrollment.sourceSheet,
    templateName: template.name,
    templateLanguage: template.language,
    variableMode: template.variableMode,
    variableMappings: template.variables
  };
  const outbound = await createOutboundConversationMessage({
    tenantId: enrollment.tenantId,
    conversationId: enrollment.conversationId ?? enrollment.conversation?.id ?? "",
    type: "TEMPLATE",
    body,
    whatsappMessageId: sendResult.whatsappMessageId,
    status: sendResult.ok ? "PENDING" : "FAILED",
    failureReason: sendResult.error ?? null,
    metadata: (metaLimit ? withMetaDeliveryLimitMetadata(messageMetadata, metaLimit) : messageMetadata) as Prisma.InputJsonObject
  });
  const sentAt = new Date();
  const completedRecord: DeliveryRecord = {
    ...sendingRecord,
    sentAt: sentAt.toISOString(),
    deliveryStatus,
    messageId: outbound.message.id,
    whatsappMessageId: sendResult.whatsappMessageId ?? null,
    error: sendResult.error ?? null
  };
  const completedRecords = upsertDeliveryRecord(sendingRecords, completedRecord);

  if (metaLimit) {
    await prisma.contact.update({
      where: { id: enrollment.contactId },
      data: {
        customFields: withContactMetaDeliveryLimit(
          enrollment.contact.customFields,
          metaLimit,
          outbound.message.id
        ) as Prisma.InputJsonValue
      }
    });
  }

  const next = sendResult.ok ? nextStep(enrollment, stepNumber) : null;
  const nextSendAt = next ? scheduledForStep(enrollment, next.delayDays) : null;
  const nextStatus: CampaignEnrollmentStatus = sendResult.ok ? (next ? "ACTIVE" : "COMPLETED") : "FAILED";
  await prisma.automationCampaignEnrollment.update({
    where: { id: enrollment.id },
    data: {
      status: nextStatus,
      currentStep: stepNumber,
      nextStepNumber: next?.stepNumber ?? null,
      nextSendAt,
      lastSentAt: sentAt,
      lastDeliveryStatus: deliveryStatus,
      lastMessageId: outbound.message.id,
      lastWhatsAppMessageId: sendResult.whatsappMessageId ?? null,
      failureReason: sendResult.error ?? null,
      stepDeliveries: completedRecords as unknown as Prisma.InputJsonArray
    }
  });

  await safeUsage({
    tenantId: enrollment.tenantId,
    eventType: sendResult.ok ? "source_campaign_step.queued" : "source_campaign_step.failed",
    endpoint,
    status: sendResult.ok ? "SUCCESS" : "FAILED",
    metadata: {
      campaignKey: enrollment.campaign.key,
      enrollmentId: enrollment.id,
      stepNumber,
      messageId: outbound.message.id
    }
  });

  const payload = {
    conversation: serializeConversation(outbound.conversation),
    message: serializeMessage(outbound.message)
  };
  emitTenantEvent(enrollment.tenantId, "message.created", payload);
  emitTenantEvent(enrollment.tenantId, "conversation.updated", payload.conversation);

  return {
    enrollmentId: enrollment.id,
    campaignKey: enrollment.campaign.key,
    phone: enrollment.contact.phone,
    status: sendResult.ok ? (next ? "sent" : "completed") : "failed",
    stepNumber,
    reason: metaLimit ? metaDeliveryLimitReason(metaLimit) : (sendResult.error ?? null),
    messageId: outbound.message.id,
    whatsappMessageId: sendResult.whatsappMessageId ?? null
  };
}

export async function runDueSourceCampaignSteps({
  tenantId,
  userId,
  maxSends = 50,
  enrollmentId,
  endpoint = "/api/cron/leads/sheets"
}: {
  tenantId: string;
  userId: string;
  maxSends?: number;
  enrollmentId?: string;
  endpoint?: string;
}): Promise<SourceCampaignRunResult> {
  await ensureSourceCampaignSchema();
  const now = new Date();
  const enrollments = await prisma.automationCampaignEnrollment.findMany({
    where: {
      tenantId,
      ...(enrollmentId ? { id: enrollmentId } : {}),
      status: "ACTIVE",
      nextStepNumber: { not: null },
      nextSendAt: { lte: now }
    },
    include: {
      campaign: { include: { steps: true } },
      contact: true,
      conversation: true
    },
    orderBy: [{ nextSendAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(maxSends * 4, 10), 500)
  });
  const results: SourceCampaignRunResult["results"] = [];
  const whatsappConfig = await connectedWhatsAppConfig(tenantId);
  const sheetConfig = await loadSheetCampaignConfig(tenantId);
  const sendGapMs = configuredSendGapMs();
  let attemptedSends = 0;

  for (const enrollment of enrollments) {
    if (results.filter((result) => result.status === "sent" || result.status === "failed" || result.status === "completed").length >= maxSends) {
      break;
    }

    if (!enrollment.conversationId && !enrollment.conversation?.id) {
      await failEnrollment({ enrollment, reason: "Campaign enrollment has no conversation." });
      results.push({
        enrollmentId: enrollment.id,
        campaignKey: enrollment.campaign.key,
        phone: enrollment.contact.phone,
        status: "failed",
        reason: "Campaign enrollment has no conversation."
      });
      continue;
    }

    if (attemptedSends > 0 && sendGapMs > 0) {
      await wait(sendGapMs);
    }
    attemptedSends += 1;

    // A single enrollment throwing (transient Meta/Google error, etc.) must
    // never abort the batch: enrollments are read in nextSendAt order, so an
    // unhandled exception here would permanently block every enrollment due
    // after this one on every subsequent run.
    try {
      results.push(
        await sendEnrollmentStep({
          enrollment,
          stepNumber: enrollment.nextStepNumber ?? 1,
          userId,
          whatsappConfig,
          sheetConfig,
          endpoint
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Campaign step failed unexpectedly.";
      console.error("[source-campaigns] enrollment step failed", {
        tenantId,
        enrollmentId: enrollment.id,
        campaignKey: enrollment.campaign.key,
        error: message
      });
      results.push({
        enrollmentId: enrollment.id,
        campaignKey: enrollment.campaign.key,
        phone: enrollment.contact.phone,
        status: "failed",
        stepNumber: enrollment.nextStepNumber ?? 1,
        reason: message
      });
    }
  }

  return {
    scanned: enrollments.length,
    sent: results.filter((result) => result.status === "sent" || result.status === "completed").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    stopped: results.filter((result) => result.status === "stopped").length,
    completed: results.filter((result) => result.status === "completed").length,
    results
  };
}

export async function stopActiveSourceCampaignsForContact({
  tenantId,
  contactId,
  conversationId,
  reason = "customer_reply",
  lastInboundMessageAt = new Date()
}: {
  tenantId: string;
  contactId: string;
  conversationId?: string | null;
  reason?: string;
  lastInboundMessageAt?: Date;
}) {
  await ensureSourceCampaignSchema();
  const result = await prisma.automationCampaignEnrollment.updateMany({
    where: {
      tenantId,
      contactId,
      status: "ACTIVE"
    },
    data: {
      status: "STOPPED",
      nextStepNumber: null,
      nextSendAt: null,
      stoppedAt: new Date(),
      stoppedReason: reason,
      lastInboundMessageAt,
      ...(conversationId ? { conversationId } : {})
    }
  });

  return { stopped: result.count };
}

export async function updateSourceCampaignDeliveryStatusFromWebhook({
  tenantId,
  metadata,
  deliveryStatus,
  failureReason
}: {
  tenantId: string;
  metadata: unknown;
  deliveryStatus: CampaignDeliveryStatus;
  failureReason?: string | null;
}) {
  if (metadataString(metadata, "adapter") !== SOURCE_CAMPAIGN_ADAPTER) return;
  const enrollmentId = metadataString(metadata, "campaignEnrollmentId");
  const stepNumber = metadataNumber(metadata, "stepNumber");
  if (!enrollmentId || !stepNumber) return;

  await ensureSourceCampaignSchema();
  const enrollment = await prisma.automationCampaignEnrollment.findFirst({
    where: { id: enrollmentId, tenantId }
  });
  if (!enrollment) return;

  const records = deliveryRecords(enrollment.stepDeliveries);
  const currentRecord = records.find((record) => record.stepNumber === stepNumber);
  const updatedRecords = currentRecord
    ? upsertDeliveryRecord(records, {
        ...currentRecord,
        deliveryStatus,
        error: failureReason ?? currentRecord.error ?? null
      })
    : records;

  await prisma.automationCampaignEnrollment.update({
    where: { id: enrollment.id },
    data: {
      lastDeliveryStatus: deliveryStatus,
      ...(deliveryStatus === "FAILED"
        ? {
            status: "FAILED",
            nextStepNumber: null,
            nextSendAt: null,
            failureReason: failureReason ?? "WhatsApp delivery failed."
          }
        : {}),
      stepDeliveries: updatedRecords as unknown as Prisma.InputJsonArray
    }
  });
}
