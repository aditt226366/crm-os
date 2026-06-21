import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTenantConversation } from "@/lib/inbox";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";

const handoffPatterns = [
  /we(?:'|’)ll get back to you/i,
  /we will get back to you/i,
  /our team (?:will )?(?:get back|contact|reach out)/i,
  /one of our (?:team )?members/i,
  /team member (?:will )?(?:get back|contact|reach out)/i,
  /human (?:agent|team|member|support)/i,
  /specialist (?:will )?(?:get back|contact|reach out)/i
];

const confirmedOrderPatterns = [
  /\border (?:is )?confirmed\b/i,
  /\bconfirmed (?:the )?order\b/i,
  /\beverything (?:is )?confirmed\b/i,
  /\bconfirmed\b.*\b(?:quantity|payment|delivery|address|size|colour|color|design|order)\b/i,
  /\b(?:please proceed|go ahead|proceed with (?:the )?order)\b/i
];

function transcriptText(messages: Array<{ direction: string; body: string }>) {
  return messages.map((message) => `${message.direction}: ${message.body}`).join("\n");
}

function orderNumberFromConversation(conversationId: string) {
  return `ORD-${conversationId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase().padStart(8, "0")}`;
}

export function isHumanHandoffReply(body: string) {
  return handoffPatterns.some((pattern) => pattern.test(body));
}

export function isConfirmedOrderConversation(messages: Array<{ direction: string; body: string }>) {
  const text = transcriptText(messages);
  return confirmedOrderPatterns.some((pattern) => pattern.test(text));
}

export async function ensureHumanQueueForConversation({
  tenantId,
  conversationId,
  reason = "AI requested human follow-up"
}: {
  tenantId: string;
  conversationId: string;
  reason?: string;
}) {
  await ensureLeadWorkspaceSchema();
  const conversation = await getTenantConversation(tenantId, conversationId);
  const existingQueueItem = await prisma.humanQueueItem.findFirst({
    where: { tenantId, conversationId, status: { in: ["OPEN", "ASSIGNED"] } }
  });
  const priority = conversation.contact.leadTemperature === "HOT" ? 85 : 55;
  const queueItem = existingQueueItem
    ? await prisma.humanQueueItem.update({
        where: { id: existingQueueItem.id },
        data: {
          reason: existingQueueItem.reason || reason,
          priority: Math.max(existingQueueItem.priority, priority),
          status: existingQueueItem.status
        }
      })
    : await prisma.humanQueueItem.create({
        data: {
          tenantId,
          conversationId,
          contactId: conversation.contactId,
          reason,
          priority,
          status: "OPEN",
          slaDueAt: new Date(Date.now() + 30 * 60 * 1000)
        }
      });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      humanTakeover: true,
      humanQueueId: queueItem.id
    }
  });

  return getTenantConversation(tenantId, conversationId);
}

export async function ensureConfirmedOrderForConversation({
  tenantId,
  conversationId
}: {
  tenantId: string;
  conversationId: string;
}) {
  await ensureLeadWorkspaceSchema();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      contact: true,
      messages: { orderBy: { createdAt: "asc" }, take: 40 },
      orders: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  if (!conversation || !isConfirmedOrderConversation(conversation.messages)) {
    return null;
  }

  const transcript = transcriptText(conversation.messages).slice(-3000);
  const latestOrder = conversation.orders[0];
  if (latestOrder) {
    await prisma.order.update({
      where: { id: latestOrder.id },
      data: {
        status: latestOrder.status === "CANCELLED" ? latestOrder.status : "CONFIRMED",
        notes: latestOrder.notes ?? "Order confirmed in WhatsApp conversation.",
        extractedByAI: true,
        confidence: Math.max(latestOrder.confidence ?? 0, 0.72)
      }
    });
  } else {
    await prisma.order.create({
      data: {
        tenantId,
        contactId: conversation.contactId,
        conversationId,
        orderNumber: orderNumberFromConversation(conversationId),
        products: [{ summary: "Confirmed via WhatsApp conversation", transcript }] as Prisma.InputJsonValue,
        notes: "Order confirmed in WhatsApp conversation.",
        status: "CONFIRMED",
        extractedByAI: true,
        confidence: 0.72,
        source: conversation.source
      }
    });
  }

  await prisma.lead.updateMany({
    where: { tenantId, contactId: conversation.contactId },
    data: {
      status: "ORDER_INTENT",
      updatedAt: new Date()
    }
  });

  return getTenantConversation(tenantId, conversationId);
}

export async function syncConversationWorkflowSignals({
  tenantId,
  conversationId,
  latestAssistantReply
}: {
  tenantId: string;
  conversationId: string;
  latestAssistantReply?: string | null;
}) {
  let conversation = null;
  if (latestAssistantReply && isHumanHandoffReply(latestAssistantReply)) {
    conversation = await ensureHumanQueueForConversation({
      tenantId,
      conversationId,
      reason: "AI could not answer and requested team follow-up"
    });
  }

  const orderConversation = await ensureConfirmedOrderForConversation({ tenantId, conversationId });
  return orderConversation ?? conversation;
}
