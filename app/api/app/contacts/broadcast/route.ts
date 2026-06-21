import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse, json } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { readEncryptedConfig } from "@/lib/integration-vault";
import { renderTemplateBody, sendWhatsAppTemplateMessage } from "@/lib/whatsapp-cloud";
import { emitTenantEvent } from "@/lib/realtime";
import { safeCreateAuditLog } from "@/lib/audit";
import {
  activeMetaDeliveryLimit,
  activeMetaDeliveryLimitFromMessage,
  createMetaDeliveryLimit,
  isMetaDeliveryLimitError,
  metaDeliveryLimitReason,
  withContactMetaDeliveryLimit,
  withMetaDeliveryLimitMetadata
} from "@/lib/meta-delivery-limit";

export const maxDuration = 300;

const SEND_GAP_MS = 6000;

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
      data: {
        customFields: withContactMetaDeliveryLimit(customFields, limit, failure.id) as Prisma.InputJsonValue
      }
    });
    return limit;
  }

  return null;
}

async function getOrCreateBroadcastConversation({
  tenantId,
  contactId,
  broadcastId
}: {
  tenantId: string;
  contactId: string;
  broadcastId: string;
}) {
  const existing = await prisma.conversation.findFirst({
    where: { tenantId, contactId, status: { not: "RESOLVED" } },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }]
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      tenantId,
      contactId,
      source: "BROADCAST",
      sourceId: broadcastId,
      status: "OPEN"
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "CONTACTS");
    const tenantId = user.tenantId!;
    await Promise.all([ensureIntegrationSchema(), ensureLeadWorkspaceSchema()]);

    const body = (await request.json()) as { templateId?: unknown; contactIds?: unknown };
    const templateId = String(body.templateId ?? "").trim();
    const contactIds = Array.isArray(body.contactIds)
      ? Array.from(new Set(body.contactIds.map((id) => String(id).trim()).filter(Boolean)))
      : [];

    if (!templateId) {
      throw new ApiError(400, "TEMPLATE_REQUIRED", "Select an approved template before broadcasting.");
    }
    if (!contactIds.length) {
      throw new ApiError(400, "CONTACTS_REQUIRED", "Import opted-in contacts before broadcasting.");
    }
    if (contactIds.length > 1000) {
      throw new ApiError(413, "BROADCAST_TOO_LARGE", "Send up to 1000 contacts per broadcast.");
    }

    const [integration, template, contacts] = await Promise.all([
      prisma.integration.findUnique({
        where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } }
      }),
      prisma.whatsAppTemplate.findFirst({
        where: { tenantId, id: templateId, status: "APPROVED" }
      }),
      prisma.contact.findMany({
        where: { tenantId, id: { in: contactIds } },
        orderBy: { createdAt: "asc" }
      })
    ]);

    if (integration?.status !== "CONNECTED") {
      throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", "WhatsApp Cloud API is not connected for this company.");
    }
    if (!template) {
      throw new ApiError(404, "TEMPLATE_NOT_APPROVED", "Approved template not found for this company.");
    }

    const config = readEncryptedConfig(integration.encryptedConfig);
    const broadcast = await prisma.broadcast.create({
      data: {
        tenantId,
        name: `Contacts broadcast - ${template.name}`,
        status: "SENDING",
        templateId: template.id,
        launchedAt: new Date(),
        createdById: user.id,
        stats: {
          queued: contacts.length,
          sent: 0,
          failed: 0,
          skipped: 0,
          deliveryLimited: 0,
          gapMs: SEND_GAP_MS
        }
      }
    });

    const stats = {
      queued: contacts.length,
      sent: 0,
      failed: 0,
      skipped: 0,
      deliveryLimited: 0,
      gapMs: SEND_GAP_MS
    };
    const results: Array<{ contactId: string; phone: string; status: string; error?: string | null }> = [];

    for (let index = 0; index < contacts.length; index += 1) {
      const contact = contacts[index];
      const deliveryLimit =
        contact.optIn && !contact.optOut
          ? await activeMetaDeliveryLimitForContact({
              tenantId,
              contactId: contact.id,
              customFields: contact.customFields
            })
          : null;
      const recipient = await prisma.broadcastRecipient.create({
        data: {
          tenantId,
          broadcastId: broadcast.id,
          contactId: contact.id,
          status: contact.optIn && !contact.optOut && !deliveryLimit ? "QUEUED" : "SKIPPED",
          error: deliveryLimit
            ? metaDeliveryLimitReason(deliveryLimit)
            : contact.optIn && !contact.optOut
              ? null
              : "Contact is not opted in or has opted out."
        }
      });

      if (!contact.optIn || contact.optOut) {
        stats.skipped += 1;
        results.push({ contactId: contact.id, phone: contact.phone, status: "SKIPPED", error: "Contact is not opted in or has opted out." });
        continue;
      }
      if (deliveryLimit) {
        stats.skipped += 1;
        stats.deliveryLimited += 1;
        results.push({
          contactId: contact.id,
          phone: contact.phone,
          status: "META_DELIVERY_LIMITED",
          error: metaDeliveryLimitReason(deliveryLimit)
        });
        continue;
      }

      const conversation = await getOrCreateBroadcastConversation({
        tenantId,
        contactId: contact.id,
        broadcastId: broadcast.id
      });
      const renderedBody = renderTemplateBody(template.body, {
        name: contact.name,
        phone: contact.phone
      });

      const sendResult = await sendWhatsAppTemplateMessage({
        config,
        to: contact.phone,
        templateName: template.name,
        language: template.language,
        variables: template.body.includes("{{") ? [contact.name] : undefined
      });
      const immediateDeliveryLimit =
        !sendResult.ok && isMetaDeliveryLimitError(sendResult.error)
          ? createMetaDeliveryLimit({ reason: sendResult.error })
          : null;
      const messageMetadata = {
        broadcastId: broadcast.id,
        broadcastRecipientId: recipient.id,
        templateName: template.name,
        adapter: "contacts_broadcast",
        gapMs: SEND_GAP_MS
      };

      const outbound = await createOutboundConversationMessage({
        tenantId,
        conversationId: conversation.id,
        type: "TEMPLATE",
        templateId: template.id,
        body: renderedBody,
        whatsappMessageId: sendResult.whatsappMessageId,
        status: sendResult.ok ? "SENT" : "FAILED",
        failureReason: sendResult.error ?? null,
        metadata: (immediateDeliveryLimit
          ? withMetaDeliveryLimitMetadata(messageMetadata, immediateDeliveryLimit)
          : messageMetadata) as Prisma.InputJsonObject
      });

      if (immediateDeliveryLimit) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: {
            customFields: withContactMetaDeliveryLimit(
              contact.customFields,
              immediateDeliveryLimit,
              outbound.message.id
            ) as Prisma.InputJsonValue
          }
        });
      }

      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          conversationId: conversation.id,
          messageId: outbound.message.id,
          status: sendResult.ok ? "SENT" : "FAILED",
          error: sendResult.error ?? null,
          sentAt: sendResult.ok ? new Date() : null
        }
      });

      if (sendResult.ok) stats.sent += 1;
      else if (immediateDeliveryLimit) stats.deliveryLimited += 1;
      else stats.failed += 1;
      results.push({
        contactId: contact.id,
        phone: contact.phone,
        status: sendResult.ok ? "SENT" : immediateDeliveryLimit ? "META_DELIVERY_LIMITED" : "FAILED",
        error: immediateDeliveryLimit ? metaDeliveryLimitReason(immediateDeliveryLimit) : (sendResult.error ?? null)
      });

      const payload = {
        conversation: serializeConversation(outbound.conversation),
        message: serializeMessage(outbound.message)
      };
      emitTenantEvent(tenantId, "message.created", payload);
      emitTenantEvent(tenantId, "conversation.updated", payload.conversation);

      if (index < contacts.length - 1) {
        await wait(SEND_GAP_MS);
      }
    }

    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        status: stats.failed > 0 && stats.sent === 0 ? "FAILED" : "COMPLETED",
        completedAt: new Date(),
        stats: stats as Prisma.InputJsonValue
      }
    });

    void safeCreateAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "contacts.broadcast_sent",
      entityType: "Broadcast",
      entityId: broadcast.id,
      newValue: stats
    });

    return json({
      ok: true,
      broadcastId: broadcast.id,
      stats,
      results,
      message: `Broadcast completed: ${stats.sent} sent, ${stats.failed} failed, ${stats.skipped} skipped.`
    });
  } catch (error) {
    return errorResponse(error);
  }
}
