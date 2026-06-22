import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { emitTenantEvent } from "@/lib/realtime";
import { recordUsage } from "@/lib/usage";
import {
  activeMetaDeliveryLimit,
  activeMetaDeliveryLimitFromMessage,
  createMetaDeliveryLimit,
  isMetaDeliveryLimitError,
  metaDeliveryLimitReason,
  withContactMetaDeliveryLimit,
  withMetaDeliveryLimitMetadata
} from "@/lib/meta-delivery-limit";
import { renderTemplateBody, sendWhatsAppTemplateMessage } from "@/lib/whatsapp-cloud";
import {
  asRecord,
  readScrapFollowUpState,
  SCRAP_DORMANT_TAG,
  SCRAP_FOLLOW_UP_ADAPTER,
  withScrapDormantTag,
  withScrapFollowUpState
} from "@/lib/scrap-follow-up-state";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SEND_GAP_MS = 6000;
const MAX_FAILURES = 2;
const FAILED_RETRY_MS = 30 * 60 * 1000;

const FOLLOW_UPS = {
  1: {
    waitMs: DAY_MS,
    body: "Hi {{name}}, just checking if you are still looking for custom printing. Reply with product and quantity.",
    templateEnvName: "SCRAP_FOLLOW_UP_1_TEMPLATE_NAME",
    templateEnvLanguage: "SCRAP_FOLLOW_UP_1_TEMPLATE_LANGUAGE",
    candidates: ["scrap_follow_up_1", "scrap_followup_1", "lead_follow_up_1", "follow_up_1"]
  },
  2: {
    waitMs: 2 * DAY_MS,
    body: "Hi {{name}}, this is our final follow-up. Let us know if you need custom t-shirts, hoodies, or uniforms.",
    templateEnvName: "SCRAP_FOLLOW_UP_2_TEMPLATE_NAME",
    templateEnvLanguage: "SCRAP_FOLLOW_UP_2_TEMPLATE_LANGUAGE",
    candidates: ["scrap_follow_up_2", "scrap_followup_2", "lead_follow_up_2", "follow_up_2"]
  }
} as const;

type FollowUpStep = keyof typeof FOLLOW_UPS;

type ConversationForFollowUp = Prisma.ConversationGetPayload<{
  include: {
    contact: true;
    queueItems: true;
    orders: true;
    messages: true;
  };
}>;

export type ScrapFollowUpRunResult = {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  dormant: number;
  templateMissing: number;
  results: Array<{
    conversationId: string;
    contactId: string;
    phone: string;
    status: "sent" | "failed" | "skipped" | "dormant";
    step?: FollowUpStep;
    reason?: string;
  }>;
};

function configuredSendGapMs() {
  const value = Number(process.env.SCRAP_FOLLOW_UP_SEND_GAP_MS);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_SEND_GAP_MS;
  return Math.min(Math.round(value), 60_000);
}

function configuredMaxPerRun() {
  const value = Number(process.env.SCRAP_FOLLOW_UP_MAX_PER_RUN);
  if (!Number.isFinite(value) || value <= 0) return 50;
  return Math.min(Math.max(Math.round(value), 1), 200);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function metadataStep(metadata: unknown): FollowUpStep | null {
  const value = asRecord(metadata).scrapFollowUpStep;
  const step = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return step === 1 || step === 2 ? step : null;
}

function isScrapFollowUpMessage(message: { metadata: unknown }) {
  return asRecord(message.metadata).adapter === SCRAP_FOLLOW_UP_ADAPTER;
}

function firstOutboundTemplate(conversation: ConversationForFollowUp) {
  return conversation.messages.find((message) => message.direction === "OUTBOUND" && message.type === "TEMPLATE") ?? null;
}

function firstNonFailedStepMessage(conversation: ConversationForFollowUp, step: FollowUpStep) {
  return (
    conversation.messages.find(
      (message) => isScrapFollowUpMessage(message) && metadataStep(message.metadata) === step && message.status !== "FAILED"
    ) ?? null
  );
}

function latestFailedFollowUp(conversation: ConversationForFollowUp) {
  return [...conversation.messages]
    .reverse()
    .find((message) => isScrapFollowUpMessage(message) && message.status === "FAILED");
}

function failedFollowUpCount(conversation: ConversationForFollowUp) {
  return conversation.messages.filter((message) => isScrapFollowUpMessage(message) && message.status === "FAILED").length;
}

function hasOpenHumanQueue(conversation: ConversationForFollowUp) {
  return conversation.queueItems.some((item) => item.status === "OPEN" || item.status === "ASSIGNED");
}

function hasOrder(conversation: ConversationForFollowUp) {
  return conversation.orders.length > 0;
}

function contactName(conversation: ConversationForFollowUp) {
  return conversation.contact.name?.trim() || "there";
}

function variableValue(key: string, conversation: ConversationForFollowUp) {
  const normalized = key.toLowerCase();
  if (normalized === "name" || normalized === "customer_name" || normalized === "1") return contactName(conversation);
  if (normalized === "phone" || normalized === "mobile") return conversation.contact.phone;
  if (normalized === "city" || normalized === "delivery_city") return "";
  return contactName(conversation);
}

function templateVariables(templateBody: string, conversation: ConversationForFollowUp) {
  const keys = Array.from(templateBody.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)).map((match) => match[1]);
  const named: Record<string, string> = {};
  const positional = keys.map((key) => {
    const value = variableValue(key, conversation);
    named[key] = value;
    return value;
  });

  return {
    named,
    positional: positional.length ? positional : undefined
  };
}

async function resolveFollowUpTemplate(tenantId: string, step: FollowUpStep) {
  const definition = FOLLOW_UPS[step];
  const configuredName = process.env[definition.templateEnvName]?.trim();
  const configuredLanguage = process.env[definition.templateEnvLanguage]?.trim();

  if (configuredName) {
    return prisma.whatsAppTemplate.findFirst({
      where: {
        tenantId,
        name: configuredName,
        status: "APPROVED",
        ...(configuredLanguage ? { language: configuredLanguage } : {})
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  const templates = await prisma.whatsAppTemplate.findMany({
    where: { tenantId, status: "APPROVED" },
    orderBy: { updatedAt: "desc" },
    take: 100
  });
  const expectedBody = normalizeText(definition.body);
  return (
    templates.find((template) => normalizeText(template.body) === expectedBody) ??
    templates.find((template) => (definition.candidates as readonly string[]).includes(template.name.toLowerCase())) ??
    null
  );
}

async function updateContactScrapState({
  contactId,
  customFields,
  tags,
  state,
  dormant
}: {
  contactId: string;
  customFields: unknown;
  tags: string[];
  state: Record<string, unknown>;
  dormant?: boolean;
}) {
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      customFields: withScrapFollowUpState(customFields, state) as Prisma.InputJsonValue,
      ...(dormant ? { tags: withScrapDormantTag(tags) } : {})
    }
  });
}

async function markDormant(conversation: ConversationForFollowUp, reason: string) {
  const state = {
    ...readScrapFollowUpState(conversation.contact.customFields),
    dormantAt: new Date().toISOString(),
    stoppedReason: reason
  };
  await updateContactScrapState({
    contactId: conversation.contactId,
    customFields: conversation.contact.customFields,
    tags: conversation.contact.tags,
    state,
    dormant: true
  });
}

async function stopForMetaLimit(conversation: ConversationForFollowUp, limitReason: string) {
  const limit = createMetaDeliveryLimit({ reason: limitReason });
  const state = {
    ...readScrapFollowUpState(conversation.contact.customFields),
    stoppedReason: "meta_delivery_limited",
    retryAfter: limit.retryAfter
  };
  await prisma.contact.update({
    where: { id: conversation.contactId },
    data: {
      customFields: withScrapFollowUpState(
        withContactMetaDeliveryLimit(conversation.contact.customFields, limit),
        state
      ) as Prisma.InputJsonValue
    }
  });
  return limit;
}

async function safeUsage(input: {
  tenantId: string;
  eventType: string;
  status: string;
  metadata?: unknown;
}) {
  try {
    await recordUsage({
      tenantId: input.tenantId,
      feature: "LEAD_MANAGEMENT",
      provider: "meta",
      eventType: input.eventType,
      endpoint: "/api/cron/leads/sheets",
      units: 1,
      cost: input.status === "SUCCESS" ? 0.006 : 0,
      status: input.status,
      metadata: input.metadata
    });
  } catch (error) {
    console.error("[scrap-follow-up.usage] failed", error instanceof Error ? error.message : String(error));
  }
}

async function sendFollowUp({
  tenantId,
  userId,
  conversation,
  step,
  template
}: {
  tenantId: string;
  userId: string;
  conversation: ConversationForFollowUp;
  step: FollowUpStep;
  template: NonNullable<Awaited<ReturnType<typeof resolveFollowUpTemplate>>>;
}) {
  const variables = templateVariables(template.body, conversation);
  const sendResult = await sendWhatsAppTemplateMessage({
    config: await whatsappConfig(tenantId),
    to: conversation.contact.phone,
    templateName: template.name,
    language: template.language,
    variables: variables.positional
  });
  const deliveryLimit =
    !sendResult.ok && isMetaDeliveryLimitError(sendResult.error)
      ? createMetaDeliveryLimit({ reason: sendResult.error })
      : null;
  const body = renderTemplateBody(template.body, variables.named);
  const metadata = {
    adapter: SCRAP_FOLLOW_UP_ADAPTER,
    sentByUserId: userId,
    scrapFollowUpStep: step,
    finalAutomaticFollowUp: step === 2,
    templateName: template.name,
    templateLanguage: template.language
  };
  const outbound = await createOutboundConversationMessage({
    tenantId,
    conversationId: conversation.id,
    type: "TEMPLATE",
    templateId: template.id,
    body,
    whatsappMessageId: sendResult.whatsappMessageId,
    status: sendResult.ok ? "PENDING" : "FAILED",
    failureReason: sendResult.error ?? null,
    metadata: (deliveryLimit ? withMetaDeliveryLimitMetadata(metadata, deliveryLimit) : metadata) as Prisma.InputJsonObject
  });

  const nowIso = new Date().toISOString();
  const currentState = readScrapFollowUpState(conversation.contact.customFields);
  const nextFailures = (currentState.failures ?? 0) + (sendResult.ok ? 0 : 1);
  const state = {
    ...currentState,
    followUpsSent: sendResult.ok ? Math.max(currentState.followUpsSent ?? 0, step) : (currentState.followUpsSent ?? 0),
    ...(step === 1 && sendResult.ok ? { followUp1SentAt: nowIso } : {}),
    ...(step === 2 && sendResult.ok ? { followUp2SentAt: nowIso, dormantAt: nowIso, stoppedReason: "max_followups_sent" } : {}),
    ...(sendResult.ok ? {} : { failures: nextFailures, lastFailedAt: nowIso, lastFailureReason: sendResult.error ?? "WhatsApp send failed" }),
    ...(deliveryLimit ? { stoppedReason: "meta_delivery_limited", retryAfter: deliveryLimit.retryAfter } : {}),
    ...(!sendResult.ok && nextFailures >= MAX_FAILURES ? { stoppedReason: "follow_up_failed_repeatedly" } : {})
  };

  await prisma.contact.update({
    where: { id: conversation.contactId },
    data: {
      customFields: (deliveryLimit
        ? withScrapFollowUpState(withContactMetaDeliveryLimit(conversation.contact.customFields, deliveryLimit, outbound.message.id), state)
        : withScrapFollowUpState(conversation.contact.customFields, state)) as Prisma.InputJsonValue,
      ...(sendResult.ok && step === 2 ? { tags: withScrapDormantTag(conversation.contact.tags) } : {})
    }
  });

  await safeUsage({
    tenantId,
    eventType: sendResult.ok
      ? `scrap_follow_up_${step}.queued`
      : deliveryLimit
        ? `scrap_follow_up_${step}.meta_delivery_limited`
        : `scrap_follow_up_${step}.failed`,
    status: sendResult.ok ? "SUCCESS" : "FAILED",
    metadata: { conversationId: conversation.id, messageId: outbound.message.id, step, templateName: template.name }
  });

  const payload = {
    conversation: serializeConversation(outbound.conversation),
    message: serializeMessage(outbound.message)
  };
  emitTenantEvent(tenantId, "message.created", payload);
  emitTenantEvent(tenantId, "conversation.updated", payload.conversation);

  return {
    ok: sendResult.ok,
    deliveryLimit,
    error: sendResult.error ?? null
  };
}

async function whatsappConfig(tenantId: string): Promise<IntegrationConfig> {
  const integration = await prisma.integration.findUnique({
    where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } },
    select: { status: true, encryptedConfig: true }
  });
  if (integration?.status !== "CONNECTED") {
    throw new Error("WhatsApp Cloud API is not connected.");
  }
  return readEncryptedConfig(integration.encryptedConfig);
}

async function dueStep(conversation: ConversationForFollowUp, now: Date): Promise<{ step: FollowUpStep } | { skip: string; dormant?: boolean }> {
  const state = readScrapFollowUpState(conversation.contact.customFields);
  if (state.dormantAt || conversation.contact.tags.includes(SCRAP_DORMANT_TAG)) return { skip: "Scrap Dormant", dormant: true };
  if (!conversation.contact.optIn || conversation.contact.optOut) return { skip: "Contact opted out" };
  if (conversation.customerReplyCount > 0 || conversation.contact.customerReplyCount > 0) return { skip: "Customer replied" };
  if (conversation.humanTakeover || hasOpenHumanQueue(conversation)) return { skip: "Human queue active" };
  if (hasOrder(conversation)) return { skip: "Order already created" };

  const contactLimit = activeMetaDeliveryLimit(conversation.contact.customFields);
  if (contactLimit) return { skip: metaDeliveryLimitReason(contactLimit) };

  for (const message of [...conversation.messages].reverse()) {
    const limit = activeMetaDeliveryLimitFromMessage(message);
    if (!limit) continue;
    await stopForMetaLimit(conversation, limit.reason);
    return { skip: metaDeliveryLimitReason(limit) };
  }

  const failedCount = Math.max(failedFollowUpCount(conversation), state.failures ?? 0);
  if (failedCount >= MAX_FAILURES) {
    await updateContactScrapState({
      contactId: conversation.contactId,
      customFields: conversation.contact.customFields,
      tags: conversation.contact.tags,
      state: {
        ...state,
        stoppedReason: "follow_up_failed_repeatedly",
        failures: failedCount
      }
    });
    return { skip: "Message failed repeatedly" };
  }

  const followUp2 = firstNonFailedStepMessage(conversation, 2);
  if (followUp2 || state.followUp2SentAt) {
    await markDormant(conversation, "max_followups_sent");
    return { skip: "Scrap Dormant", dormant: true };
  }

  const failedMessage = latestFailedFollowUp(conversation);
  if (failedMessage && now.getTime() - failedMessage.updatedAt.getTime() < FAILED_RETRY_MS) {
    return { skip: "Waiting before retrying failed follow-up" };
  }

  const firstOutbound = firstOutboundTemplate(conversation);
  if (!firstOutbound) return { skip: "No welcome template found" };

  const followUp1 = firstNonFailedStepMessage(conversation, 1);
  const followUp1SentAt = state.followUp1SentAt ? new Date(state.followUp1SentAt) : followUp1?.createdAt;
  if (!followUp1SentAt) {
    return now.getTime() - firstOutbound.createdAt.getTime() >= FOLLOW_UPS[1].waitMs ? { step: 1 } : { skip: "Waiting 24 hours" };
  }

  return now.getTime() - followUp1SentAt.getTime() >= FOLLOW_UPS[2].waitMs ? { step: 2 } : { skip: "Waiting 48 hours" };
}

export async function runDueScrapFollowUps({
  tenantId,
  userId,
  maxConversations = configuredMaxPerRun()
}: {
  tenantId: string;
  userId: string;
  maxConversations?: number;
}): Promise<ScrapFollowUpRunResult> {
  await ensureLeadWorkspaceSchema();
  const now = new Date();
  const sendGapMs = configuredSendGapMs();
  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      source: "GOOGLE_SHEET",
      status: { in: ["OPEN", "PENDING"] },
      customerReplyCount: { lte: 1 },
      contact: {
        leadTemperature: "SCRAP"
      }
    },
    include: {
      contact: true,
      queueItems: { where: { status: { in: ["OPEN", "ASSIGNED"] } } },
      orders: { take: 1, orderBy: { createdAt: "desc" } },
      messages: { orderBy: { createdAt: "asc" }, take: 80 }
    },
    orderBy: [{ lastMessageAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(maxConversations * 4, 20), 500)
  });
  const results: ScrapFollowUpRunResult["results"] = [];
  const templateCache = new Map<FollowUpStep, Awaited<ReturnType<typeof resolveFollowUpTemplate>>>();
  let attemptedSends = 0;

  for (const conversation of conversations) {
    if (results.filter((result) => result.status === "sent" || result.status === "failed").length >= maxConversations) {
      break;
    }

    const due = await dueStep(conversation, now);
    if ("skip" in due) {
      results.push({
        conversationId: conversation.id,
        contactId: conversation.contactId,
        phone: conversation.contact.phone,
        status: due.dormant ? "dormant" : "skipped",
        reason: due.skip
      });
      continue;
    }

    if (!templateCache.has(due.step)) {
      templateCache.set(due.step, await resolveFollowUpTemplate(tenantId, due.step));
    }
    const template = templateCache.get(due.step);
    if (!template) {
      results.push({
        conversationId: conversation.id,
        contactId: conversation.contactId,
        phone: conversation.contact.phone,
        status: "skipped",
        step: due.step,
        reason: `Approved Scrap follow-up ${due.step} template is not configured.`
      });
      continue;
    }

    if (attemptedSends > 0 && sendGapMs > 0) {
      await wait(sendGapMs);
    }
    attemptedSends += 1;

    const sendResult = await sendFollowUp({ tenantId, userId, conversation, step: due.step, template });
    results.push({
      conversationId: conversation.id,
      contactId: conversation.contactId,
      phone: conversation.contact.phone,
      status: sendResult.ok ? (due.step === 2 ? "dormant" : "sent") : "failed",
      step: due.step,
      reason: sendResult.deliveryLimit ? metaDeliveryLimitReason(sendResult.deliveryLimit) : (sendResult.error ?? undefined)
    });
  }

  return {
    scanned: conversations.length,
    sent: results.filter((result) => result.status === "sent" || (result.status === "dormant" && result.step)).length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    dormant: results.filter((result) => result.status === "dormant").length,
    templateMissing: results.filter((result) => result.reason?.includes("template is not configured")).length,
    results
  };
}
