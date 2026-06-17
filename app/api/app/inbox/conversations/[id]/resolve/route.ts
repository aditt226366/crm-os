import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { getTenantConversation, serializeConversation } from "@/lib/inbox";
import { emitTenantEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const tenantId = user.tenantId!;
    const { id } = await context.params;
    await getTenantConversation(tenantId, id);

    await prisma.$transaction([
      prisma.conversation.update({
        where: { id },
        data: { status: "RESOLVED", unreadCount: 0 }
      }),
      prisma.humanQueueItem.updateMany({
        where: { tenantId, conversationId: id, status: { in: ["OPEN", "ASSIGNED"] } },
        data: { status: "RESOLVED", resolvedAt: new Date() }
      })
    ]);

    const conversation = await getTenantConversation(tenantId, id);
    await writeAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "inbox.conversation_resolved",
      entityType: "Conversation",
      entityId: id
    });

    const payload = serializeConversation(conversation);
    emitTenantEvent(tenantId, "conversation.updated", payload);
    return json({ conversation: payload });
  } catch (error) {
    return errorResponse(error);
  }
}
