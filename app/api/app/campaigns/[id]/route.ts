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

type Context = { params: Promise<{ id: string }> };

const SEND_GAP_MS = 6000;

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextResumeStatus(scheduleConfig: unknown) {
  const config = scheduleConfig && typeof scheduleConfig === "object" ? (scheduleConfig as { scheduledAt?: unknown }) : {};
  const scheduledAt = config.scheduledAt ? new Date(String(config.scheduledAt)) : null;
  return scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now() ? "SCHEDULED" : "DRAFT";
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

async function getOrCreateCampaignConversation({
  tenantId,
  contactId,
  campaignId
}: {
  tenantId: string;
  contactId: string;
  campaignId: string;
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
      source: "CAMPAIGN",
      sourceId: campaignId,
      status: "OPEN"
    }
  });
}

async function launchCampaign({
  request,
  tenantId,
  userId,
  campaignId
}: {
  request: NextRequest;
  tenantId: string;
  userId: string;
  campaignId: string;
}) {
  const campaign = await prisma.campaign.findFirst({
    where: { tenantId, id: campaignId },
    include: {
      recipients: {
        orderBy: { createdAt: "asc" },
        include: { contact: true }
      }
    }
  });

  if (!campaign) {
    throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found for this company.");
  }
  if (campaign.status === "CANCELLED" || campaign.status === "COMPLETED") {
    throw new ApiError(409, "CAMPAIGN_CLOSED", "This campaign can no longer be launched.");
  }
  if (!campaign.templateId) {
    throw new ApiError(400, "TEMPLATE_REQUIRED", "Select an approved template before launching.");
  }

  const [integration, template] = await Promise.all([
    prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } }
    }),
    prisma.whatsAppTemplate.findFirst({
      where: { tenantId, id: campaign.templateId, status: "APPROVED" }
    })
  ]);

  if (integration?.status !== "CONNECTED") {
    throw new ApiError(409, "INTEGRATION_NOT_CONNECTED", "WhatsApp Cloud API is not connected for this company.");
  }
  if (!template) {
    throw new ApiError(404, "TEMPLATE_NOT_APPROVED", "Approved template not found for this company.");
  }
  if (!campaign.recipients.length) {
    throw new ApiError(400, "AUDIENCE_REQUIRED", "Add campaign recipients before launching.");
  }

  const config = readEncryptedConfig(integration.encryptedConfig);
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "RUNNING" }
  });

  const stats = {
    total: campaign.recipients.length,
    queued: campaign.recipients.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    deliveryLimited: 0,
    replied: 0,
    converted: 0,
    gapMs: SEND_GAP_MS
  };
  const results: Array<{ contactId: string; phone: string; status: string; error?: string | null }> = [];

  for (let index = 0; index < campaign.recipients.length; index += 1) {
    const recipient = campaign.recipients[index];
    const contact = recipient.contact;
    const deliveryLimit =
      contact.optIn && !contact.optOut
        ? await activeMetaDeliveryLimitForContact({
            tenantId,
            contactId: contact.id,
            customFields: contact.customFields
          })
        : null;

    if (!contact.optIn || contact.optOut) {
      stats.skipped += 1;
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "SKIPPED",
          metadata: {
            error: "Contact is not opted in or has opted out."
          }
        }
      });
      results.push({ contactId: contact.id, phone: contact.phone, status: "SKIPPED", error: "Contact is not opted in or has opted out." });
      continue;
    }
    if (deliveryLimit) {
      stats.skipped += 1;
      stats.deliveryLimited += 1;
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "SKIPPED",
          metadata: {
            error: metaDeliveryLimitReason(deliveryLimit),
            deliveryLimit
          } as Prisma.InputJsonValue
        }
      });
      results.push({
        contactId: contact.id,
        phone: contact.phone,
        status: "META_DELIVERY_LIMITED",
        error: metaDeliveryLimitReason(deliveryLimit)
      });
      continue;
    }

    const conversation = await getOrCreateCampaignConversation({
      tenantId,
      contactId: contact.id,
      campaignId: campaign.id
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
      campaignId: campaign.id,
      campaignRecipientId: recipient.id,
      templateName: template.name,
      adapter: "campaigns",
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

    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        conversationId: conversation.id,
        messageId: outbound.message.id,
        status: sendResult.ok ? "SENT" : immediateDeliveryLimit ? "SKIPPED" : "FAILED",
        metadata: {
          error: immediateDeliveryLimit ? metaDeliveryLimitReason(immediateDeliveryLimit) : (sendResult.error ?? null),
          whatsappMessageId: sendResult.whatsappMessageId ?? null,
          sentAt: sendResult.ok ? new Date().toISOString() : null
        } as Prisma.InputJsonValue
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

    if (index < campaign.recipients.length - 1) {
      await wait(SEND_GAP_MS);
    }
  }

  const finalStatus = stats.failed > 0 && stats.sent === 0 ? "FAILED" : "COMPLETED";
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: finalStatus,
      stats: stats as Prisma.InputJsonValue
    }
  });

  void safeCreateAuditLog({
    request,
    actorUserId: userId,
    tenantId,
    action: "campaigns.launched",
    entityType: "Campaign",
    entityId: campaign.id,
    newValue: stats
  });

  return {
    ok: true,
    campaignId: campaign.id,
    stats,
    results,
    message: `Campaign launched: ${stats.sent} sent, ${stats.failed} failed, ${stats.skipped} skipped.`
  };
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "CAMPAIGNS");
    const tenantId = user.tenantId!;
    await Promise.all([ensureIntegrationSchema(), ensureLeadWorkspaceSchema()]);

    const { id } = await context.params;
    const body = (await request.json()) as { action?: unknown };
    const action = String(body.action ?? "").trim().toLowerCase();

    if (action === "launch") {
      return json(await launchCampaign({ request, tenantId, userId: user.id, campaignId: id }));
    }

    const campaign = await prisma.campaign.findFirst({
      where: { tenantId, id }
    });
    if (!campaign) {
      throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found for this company.");
    }

    let status: "DRAFT" | "SCHEDULED" | "PAUSED" | "CANCELLED";
    if (action === "pause") {
      if (campaign.status !== "SCHEDULED" && campaign.status !== "RUNNING") {
        throw new ApiError(409, "CAMPAIGN_NOT_PAUSABLE", "Only scheduled or running campaigns can be paused.");
      }
      status = "PAUSED";
    } else if (action === "resume") {
      if (campaign.status !== "PAUSED") {
        throw new ApiError(409, "CAMPAIGN_NOT_PAUSED", "Only paused campaigns can be resumed.");
      }
      status = nextResumeStatus(campaign.scheduleConfig);
    } else if (action === "cancel") {
      if (campaign.status === "COMPLETED" || campaign.status === "CANCELLED") {
        throw new ApiError(409, "CAMPAIGN_CLOSED", "This campaign is already closed.");
      }
      status = "CANCELLED";
    } else {
      throw new ApiError(400, "ACTION_INVALID", "Use launch, pause, resume, or cancel.");
    }

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status }
    });

    void safeCreateAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: `campaigns.${action}`,
      entityType: "Campaign",
      entityId: campaign.id,
      newValue: { status }
    });

    return json({
      ok: true,
      campaign: {
        id: updated.id,
        name: updated.name,
        status: updated.status
      },
      message: `Campaign ${action} complete.`
    });
  } catch (error) {
    return errorResponse(error);
  }
}
