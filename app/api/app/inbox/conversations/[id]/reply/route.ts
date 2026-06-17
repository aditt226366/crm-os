import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { ApiError, errorResponse, json } from "@/lib/api";
import { manualReplySchema } from "@/lib/validation";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { emitTenantEvent } from "@/lib/realtime";
import { recordUsage } from "@/lib/usage";
import { writeAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const tenantId = user.tenantId!;
    const { id } = await context.params;
    const body = manualReplySchema.parse(await request.json());

    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId },
      include: { contact: true }
    });
    if (!conversation) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    if (conversation.contact.optOut) {
      throw new ApiError(403, "CONTACT_OPTED_OUT", "This contact opted out. Marketing and free-form replies are blocked.");
    }
    if (!conversation.customerServiceWindowExpiresAt || conversation.customerServiceWindowExpiresAt < new Date()) {
      throw new ApiError(403, "WINDOW_CLOSED", "24-hour window closed. Use an approved template to message this contact.");
    }

    const integration = await prisma.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId,
          type: "WHATSAPP_CLOUD"
        }
      }
    });
    if (integration?.status !== "CONNECTED") {
      throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", "WhatsApp Cloud API is not connected for this company.");
    }

    const result = await createOutboundConversationMessage({
      tenantId,
      conversationId: id,
      body: body.body,
      metadata: { sentByUserId: user.id, adapter: "whatsapp-cloud-api" }
    });

    await recordUsage({
      tenantId,
      feature: "INBOX",
      provider: "meta",
      eventType: "message.queued",
      endpoint: `/api/app/inbox/conversations/${id}/reply`,
      units: 1,
      cost: 0.004,
      status: "SUCCESS",
      metadata: { messageId: result.message.id }
    });

    await writeAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "inbox.manual_reply_queued",
      entityType: "Message",
      entityId: result.message.id
    });

    const payload = {
      conversation: serializeConversation(result.conversation),
      message: serializeMessage(result.message)
    };
    emitTenantEvent(tenantId, "message.created", payload);
    emitTenantEvent(tenantId, "conversation.updated", payload.conversation);

    return json(payload, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
