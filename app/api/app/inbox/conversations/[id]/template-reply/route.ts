import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { ApiError, errorResponse, json } from "@/lib/api";
import { templateReplySchema } from "@/lib/validation";
import { createOutboundConversationMessage, getTenantConversation, serializeConversation, serializeMessage } from "@/lib/inbox";
import { emitTenantEvent } from "@/lib/realtime";
import { recordUsage } from "@/lib/usage";
import { writeAuditLog } from "@/lib/audit";
import { readEncryptedConfig } from "@/lib/integration-vault";
import { renderTemplateBody, sendWhatsAppTemplateMessage } from "@/lib/whatsapp-cloud";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const tenantId = user.tenantId!;
    const { id } = await context.params;
    const body = templateReplySchema.parse(await request.json());
    const conversation = await getTenantConversation(tenantId, id);

    if (conversation.contact.optOut) {
      throw new ApiError(403, "CONTACT_OPTED_OUT", "This contact opted out. Template messages are blocked.");
    }

    const [integration, template] = await Promise.all([
      prisma.integration.findUnique({
        where: {
          tenantId_type: {
          tenantId,
          type: "WHATSAPP_CLOUD"
        }
      }
      }),
      prisma.whatsAppTemplate.findFirst({
        where: {
          tenantId,
          id: body.templateId,
          status: "APPROVED"
        }
      })
    ]);

    if (integration?.status !== "CONNECTED") {
      throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", "WhatsApp Cloud API is not connected for this company.");
    }
    if (!template) {
      throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Approved template not found for this company.");
    }
    const variables = Object.fromEntries(
      Object.entries(body.variables ?? {}).map(([key, value]) => [key, String(value ?? "")])
    );
    const variableValues = Object.values(variables).filter(Boolean);
    const sendResult = await sendWhatsAppTemplateMessage({
      config: readEncryptedConfig(integration.encryptedConfig),
      to: conversation.contact.phone,
      templateName: template.name,
      language: template.language,
      variables: variableValues.length ? variableValues : undefined
    });
    const renderedBody = body.body || renderTemplateBody(template.body, variables);

    const result = await createOutboundConversationMessage({
      tenantId,
      conversationId: id,
      type: "TEMPLATE",
      templateId: template.id,
      body: renderedBody,
      whatsappMessageId: sendResult.whatsappMessageId,
      status: sendResult.ok ? "PENDING" : "FAILED",
      failureReason: sendResult.error ?? null,
      metadata: { sentByUserId: user.id, templateName: template.name, variables }
    });

    await recordUsage({
      tenantId,
      feature: "TEMPLATES",
      provider: "meta",
      eventType: sendResult.ok ? "template.queued" : "template.failed",
      endpoint: `/api/app/inbox/conversations/${id}/template-reply`,
      units: 1,
      cost: sendResult.ok ? 0.006 : 0,
      status: sendResult.ok ? "SUCCESS" : "FAILED",
      metadata: { messageId: result.message.id, templateId: template.id, failureReason: sendResult.error ?? null }
    });

    await writeAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "inbox.template_reply_queued",
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
