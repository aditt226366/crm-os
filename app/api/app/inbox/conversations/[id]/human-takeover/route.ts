import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { humanTakeoverSchema } from "@/lib/validation";
import { getTenantConversation, serializeConversation } from "@/lib/inbox";
import { emitTenantEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    await requireFeature(request, "HUMAN_TAKEOVER");
    const tenantId = user.tenantId!;
    const { id } = await context.params;
    const body = humanTakeoverSchema.parse(await request.json());
    const conversation = await getTenantConversation(tenantId, id);

    let queueItemId: string | null = null;
    if (body.enabled) {
      const existingQueueItem = await prisma.humanQueueItem.findFirst({
        where: { tenantId, conversationId: id, status: { in: ["OPEN", "ASSIGNED"] } }
      });
      const queueItem = existingQueueItem
        ? await prisma.humanQueueItem.update({
            where: { id: existingQueueItem.id },
            data: {
              reason: body.reason || existingQueueItem.reason,
              priority: Math.max(existingQueueItem.priority, conversation.contact.leadTemperature === "HOT" ? 80 : 45),
              assignedUserId: user.id,
              status: "ASSIGNED"
            }
          })
        : await prisma.humanQueueItem.create({
            data: {
              tenantId,
              conversationId: id,
              contactId: conversation.contactId,
              assignedUserId: user.id,
              reason: body.reason || "Manual human takeover",
              priority: conversation.contact.leadTemperature === "HOT" ? 80 : 45,
              status: "ASSIGNED",
              slaDueAt: new Date(Date.now() + 30 * 60 * 1000)
            }
          });
      queueItemId = queueItem.id;
    } else {
      await prisma.humanQueueItem.updateMany({
        where: { tenantId, conversationId: id, status: { in: ["OPEN", "ASSIGNED"] } },
        data: { status: "RESOLVED", resolvedAt: new Date() }
      });
    }

    await prisma.conversation.update({
      where: { id },
      data: {
        humanTakeover: body.enabled,
        humanQueueId: queueItemId
      }
    });

    const updatedConversation = await getTenantConversation(tenantId, id);
    await writeAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: body.enabled ? "inbox.human_takeover_enabled" : "inbox.human_takeover_disabled",
      entityType: "Conversation",
      entityId: id,
      newValue: { reason: body.reason ?? null }
    });

    const payload = serializeConversation(updatedConversation);
    emitTenantEvent(tenantId, body.enabled ? "human_queue.created" : "human_queue.updated", payload);
    emitTenantEvent(tenantId, "conversation.updated", payload);
    return json({ conversation: payload });
  } catch (error) {
    return errorResponse(error);
  }
}
