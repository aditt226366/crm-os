import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { getTenantConversation, serializeConversation } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";
import { emitTenantEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const tenantId = user.tenantId!;
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { stopped?: unknown };
    const stopped = Boolean(body.stopped);

    await getTenantConversation(tenantId, id);
    await prisma.conversation.update({
      where: { id },
      data: { aiRepliesStopped: stopped }
    });

    const conversation = await getTenantConversation(tenantId, id);
    const payload = serializeConversation(conversation);

    await writeAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: stopped ? "inbox.ai_replies_stopped" : "inbox.ai_replies_resumed",
      entityType: "Conversation",
      entityId: id,
      newValue: { aiRepliesStopped: stopped }
    });

    emitTenantEvent(tenantId, "conversation.updated", payload);
    return json({ conversation: payload });
  } catch (error) {
    return errorResponse(error);
  }
}
