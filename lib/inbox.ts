import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { recalculateConversationLeadTemperature } from "@/lib/lead-temperature";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { SCRAP_DORMANT_TAG, withoutScrapDormantTag } from "@/lib/scrap-follow-up-state";

type ConversationMessageType = "TEXT" | "TEMPLATE" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO" | "SYSTEM" | "NOTE";

export function normalizePhone(phone: string) {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }
  return `+${trimmed.replace(/\D/g, "")}`;
}

export function serializeMessage(message: {
  id: string;
  conversationId: string;
  contactId: string;
  direction: string;
  type: string;
  body: string;
  templateId: string | null;
  whatsappMessageId: string | null;
  status: string;
  failureReason: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    contactId: message.contactId,
    direction: message.direction,
    type: message.type,
    body: message.body,
    templateId: message.templateId,
    whatsappMessageId: message.whatsappMessageId,
    status: message.status,
    failureReason: message.failureReason,
    metadata: message.metadata,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString()
  };
}

export function serializeConversation(conversation: {
  id: string;
  tenantId: string;
  contactId: string;
  assignedUserId: string | null;
  source: string;
  sourceId: string | null;
  status: string;
  unreadCount: number;
  humanTakeover: boolean;
  customerReplyCount: number;
  aiRepliesStopped: boolean;
  totalMessageCount: number;
  lastMessageText: string | null;
  lastMessageAt: Date | null;
  customerServiceWindowExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contact: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    optIn: boolean;
    optOut: boolean;
    source: string;
    tags: string[];
    leadTemperature: string;
    leadTemperatureOverride: string | null;
    leadTemperatureOverrideReason: string | null;
    customerReplyCount: number;
    totalMessageCount: number;
    lastMessageAt: Date | null;
    lastContactedAt: Date | null;
  };
  leads?: Array<{ temperature: string }>;
  queueItems?: Array<{ id: string; status: string; priority: number; reason: string }>;
  orders?: Array<{ id: string; status: string; orderNumber: string }>;
  hasFailedMessages?: boolean;
  hasMetaDeliveryLimitedMessages?: boolean;
}) {
  return {
    id: conversation.id,
    tenantId: conversation.tenantId,
    contactId: conversation.contactId,
    assignedUserId: conversation.assignedUserId,
    source: conversation.source,
    sourceId: conversation.sourceId,
    status: conversation.status,
    unreadCount: conversation.unreadCount,
    humanTakeover: conversation.humanTakeover,
    aiRepliesStopped: conversation.aiRepliesStopped,
    customerReplyCount: conversation.customerReplyCount,
    totalMessageCount: conversation.totalMessageCount,
    lastMessageText: conversation.lastMessageText,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    customerServiceWindowExpiresAt: conversation.customerServiceWindowExpiresAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    contact: {
      id: conversation.contact.id,
      name: conversation.contact.name,
      phone: conversation.contact.phone,
      email: conversation.contact.email,
      optIn: conversation.contact.optIn,
      optOut: conversation.contact.optOut,
      source: conversation.contact.source,
      tags: conversation.contact.tags,
      leadTemperature: conversation.contact.leadTemperature,
      leadTemperatureOverride: conversation.contact.leadTemperatureOverride,
      leadTemperatureOverrideReason: conversation.contact.leadTemperatureOverrideReason,
      customerReplyCount: conversation.contact.customerReplyCount,
      totalMessageCount: conversation.contact.totalMessageCount,
      lastMessageAt: conversation.contact.lastMessageAt?.toISOString() ?? null,
      lastContactedAt: conversation.contact.lastContactedAt?.toISOString() ?? null
    },
    leadTemperature: conversation.leads?.[0]?.temperature ?? conversation.contact.leadTemperature,
    humanQueue: conversation.queueItems?.find((item) => item.status !== "RESOLVED") ?? null,
    order: conversation.orders?.[0] ?? null,
    hasFailedMessages: Boolean(conversation.hasFailedMessages),
    hasMetaDeliveryLimitedMessages: Boolean(conversation.hasMetaDeliveryLimitedMessages)
  };
}

export async function getTenantConversation(tenantId: string, conversationId: string) {
  await ensureLeadWorkspaceSchema();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      contact: true,
      leads: { orderBy: { updatedAt: "desc" }, take: 1 },
      queueItems: { orderBy: [{ status: "asc" }, { priority: "desc" }] },
      orders: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  if (!conversation) {
    throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
  }

  return conversation;
}

export async function upsertInboundConversationMessage({
  tenantId,
  phone,
  name,
  body,
  messageId,
  type = "TEXT",
  metadata,
  source = "ORGANIC",
  sourceId
}: {
  tenantId: string;
  phone: string;
  name?: string;
  body: string;
  messageId?: string;
  type?: Extract<ConversationMessageType, "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO">;
  metadata?: unknown;
  source?: "BROADCAST" | "CAMPAIGN" | "AD" | "ORGANIC" | "GOOGLE_SHEET" | "MANUAL";
  sourceId?: string;
}) {
  await ensureLeadWorkspaceSchema();
  const normalizedPhone = normalizePhone(phone);

  if (messageId) {
    const existing = await prisma.message.findUnique({
      where: {
        tenantId_whatsappMessageId: {
          tenantId,
          whatsappMessageId: messageId
        }
      },
      include: { conversation: { include: { contact: true, queueItems: true, orders: true } } }
    });
    if (existing) {
      return {
        conversation: existing.conversation,
        message: existing,
        scoring: null,
        duplicate: true
      };
    }
  }

  const now = new Date();
  const serviceWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const isOptOutRequest = ["STOP", "UNSUBSCRIBE", "CANCEL"].includes(body.trim().toUpperCase());
  let contact = await prisma.contact.upsert({
    where: {
      tenantId_phone: {
        tenantId,
        phone: normalizedPhone
      }
    },
    create: {
      tenantId,
      name: name?.trim() || normalizedPhone,
      phone: normalizedPhone,
      source,
      lastMessageAt: now
    },
    update: {
      name: name?.trim() || undefined,
      lastMessageAt: now,
      optOut: isOptOutRequest ? true : undefined
    }
  });

  if (!isOptOutRequest && contact.tags.includes(SCRAP_DORMANT_TAG)) {
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: { tags: withoutScrapDormantTag(contact.tags) }
    });
  }

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
        source,
        sourceId,
        status: "OPEN",
        customerServiceWindowExpiresAt: serviceWindow
      }
    }));

  const messageMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { source, sourceId, ...(metadata as Record<string, unknown>) }
      : { source, sourceId };

  const previewBody =
    body ||
    (type === "IMAGE" ? "Image" : type === "DOCUMENT" ? "Document" : type === "AUDIO" ? "Audio" : type === "VIDEO" ? "Video" : "");

  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      direction: "INBOUND",
      type,
      body: previewBody,
      whatsappMessageId: messageId,
      status: "RECEIVED",
      metadata: messageMetadata
    }
  });

  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      source: conversation.source === "ORGANIC" ? source : conversation.source,
      sourceId: conversation.sourceId ?? sourceId,
      status: "OPEN",
      unreadCount: { increment: 1 },
      lastMessageText: previewBody,
      lastMessageAt: now,
      customerServiceWindowExpiresAt: serviceWindow,
      totalMessageCount: { increment: 1 },
      customerReplyCount: { increment: 1 }
    },
    include: { contact: true, queueItems: true, orders: true }
  });

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      lastMessageAt: now,
      totalMessageCount: { increment: 1 },
      customerReplyCount: { increment: 1 }
    }
  });

  const scoring = await recalculateConversationLeadTemperature({
    tenantId,
    contactId: contact.id,
    conversationId: conversation.id
  });

  const refreshedConversation = await getTenantConversation(tenantId, updatedConversation.id);

  return {
    conversation: refreshedConversation,
    message,
    scoring,
    duplicate: false
  };
}

export async function createOutboundConversationMessage({
  tenantId,
  conversationId,
  body,
  type = "TEXT",
  templateId,
  metadata,
  status,
  whatsappMessageId,
  failureReason
}: {
  tenantId: string;
  conversationId: string;
  body: string;
  type?: ConversationMessageType;
  templateId?: string;
  metadata?: unknown;
  status?: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  whatsappMessageId?: string;
  failureReason?: string | null;
}) {
  const conversation = await getTenantConversation(tenantId, conversationId);
  const now = new Date();
  const messageStatus = status ?? (type === "NOTE" ? "SENT" : "PENDING");

  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      direction: "OUTBOUND",
      type,
      body,
      templateId,
      whatsappMessageId,
      status: messageStatus,
      failureReason,
      metadata: metadata === undefined ? undefined : (metadata as object)
    }
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageText: body,
      lastMessageAt: now,
      totalMessageCount: { increment: 1 },
      unreadCount: type === "NOTE" ? conversation.unreadCount : 0
    }
  });

  await prisma.contact.update({
    where: { id: conversation.contactId },
    data: {
      lastMessageAt: now,
      lastContactedAt: type === "NOTE" ? undefined : now,
      totalMessageCount: { increment: 1 }
    }
  });

  return {
    conversation: await getTenantConversation(tenantId, conversation.id),
    message
  };
}
