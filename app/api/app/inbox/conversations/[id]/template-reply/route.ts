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
import {
  activeMetaDeliveryLimit,
  activeMetaDeliveryLimitFromMessage,
  createMetaDeliveryLimit,
  isMetaDeliveryLimitError,
  metaDeliveryLimitReason,
  withContactMetaDeliveryLimit,
  withMetaDeliveryLimitMetadata
} from "@/lib/meta-delivery-limit";

type Context = { params: Promise<{ id: string }> };

async function activeMetaDeliveryLimitForContact({
  tenantId,
  contactId,
  customFields
}: {
  tenantId: string;
  contactId: string;
  customFields: unknown;
}) {
  const contactLimit = activeMetaDeliveryLimit(customFields);
  if (contactLimit) return contactLimit;

  const recentFailures = await prisma.message.findMany({
    where: {
      tenantId,
      contactId,
      direction: "OUTBOUND",
      type: "TEMPLATE",
      status: "FAILED",
      updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      metadata: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true
    }
  });

  for (const failure of recentFailures) {
    const limit = activeMetaDeliveryLimitFromMessage(failure);
    if (!limit) continue;
    await prisma.contact.update({
      where: { id: contactId },
      data: { customFields: withContactMetaDeliveryLimit(customFields, limit, failure.id) }
    });
    return limit;
  }

  return null;
}

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
    const deliveryLimit = await activeMetaDeliveryLimitForContact({
      tenantId,
      contactId: conversation.contactId,
      customFields: conversation.contact.customFields
    });
    if (deliveryLimit) {
      throw new ApiError(429, "META_DELIVERY_LIMITED", metaDeliveryLimitReason(deliveryLimit));
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
    const immediateDeliveryLimit =
      !sendResult.ok && isMetaDeliveryLimitError(sendResult.error)
        ? createMetaDeliveryLimit({ reason: sendResult.error })
        : null;
    const renderedBody = body.body || renderTemplateBody(template.body, variables);
    const messageMetadata = { sentByUserId: user.id, templateName: template.name, variables };

    const result = await createOutboundConversationMessage({
      tenantId,
      conversationId: id,
      type: "TEMPLATE",
      templateId: template.id,
      body: renderedBody,
      whatsappMessageId: sendResult.whatsappMessageId,
      status: sendResult.ok ? "PENDING" : "FAILED",
      failureReason: sendResult.error ?? null,
      metadata: immediateDeliveryLimit
        ? withMetaDeliveryLimitMetadata(messageMetadata, immediateDeliveryLimit)
        : messageMetadata
    });

    if (immediateDeliveryLimit) {
      await prisma.contact.update({
        where: { id: conversation.contactId },
        data: {
          customFields: withContactMetaDeliveryLimit(
            conversation.contact.customFields,
            immediateDeliveryLimit,
            result.message.id
          )
        }
      });
    }

    await recordUsage({
      tenantId,
      feature: "TEMPLATES",
      provider: "meta",
      eventType: sendResult.ok ? "template.queued" : immediateDeliveryLimit ? "template.meta_delivery_limited" : "template.failed",
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
