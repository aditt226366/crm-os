import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { conversationNoteSchema } from "@/lib/validation";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { emitTenantEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const tenantId = user.tenantId!;
    const { id } = await context.params;
    const body = conversationNoteSchema.parse(await request.json());

    const result = await createOutboundConversationMessage({
      tenantId,
      conversationId: id,
      type: "NOTE",
      body: body.body,
      metadata: { authorUserId: user.id, authorName: user.name }
    });

    await writeAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "inbox.note_added",
      entityType: "Message",
      entityId: result.message.id
    });

    const payload = {
      conversation: serializeConversation(result.conversation),
      message: serializeMessage(result.message)
    };
    emitTenantEvent(tenantId, "message.created", payload);
    return json(payload, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
