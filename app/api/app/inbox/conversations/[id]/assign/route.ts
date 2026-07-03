import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { ApiError, errorResponse, json } from "@/lib/api";
import { assignConversationSchema } from "@/lib/validation";
import { getTenantConversation, serializeConversation } from "@/lib/inbox";
import { emitTenantEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const tenantId = user.tenantId!;
    const { id } = await context.params;
    const body = assignConversationSchema.parse(await request.json());
    await getTenantConversation(tenantId, id);

    if (body.userId) {
      const assignee = await prisma.user.findFirst({
        where: { id: body.userId, tenantId, status: "ACTIVE", role: { in: ["COMPANY_OWNER", "COMPANY_AGENT"] } }
      });
      if (!assignee) {
        throw new ApiError(404, "ASSIGNEE_NOT_FOUND", "Assignee is not an active user in this company.");
      }
    }

    await prisma.conversation.update({
      where: { id },
      data: { assignedUserId: body.userId ?? null }
    });

    const conversation = await getTenantConversation(tenantId, id);
    await writeAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "inbox.conversation_assigned",
      entityType: "Conversation",
      entityId: id,
      newValue: { assignedUserId: body.userId ?? null }
    });

    const payload = serializeConversation(conversation);
    emitTenantEvent(tenantId, "conversation.updated", payload);
    return json({ conversation: payload });
  } catch (error) {
    return errorResponse(error);
  }
}
