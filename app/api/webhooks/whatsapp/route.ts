import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse, json } from "@/lib/api";
import { upsertInboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { emitTenantEvent } from "@/lib/realtime";
import { whatsappWebhookMessageSchema } from "@/lib/validation";
import { readEncryptedConfig } from "@/lib/integration-vault";
import { readGoogleSheetLeads, updateGoogleSheetLeadStatuses } from "@/lib/google-sheets-leads";
import { handleAiAgentInboundReply } from "@/lib/ai-agent";
import { downloadWhatsAppMedia, messageTypeFromMime } from "@/lib/whatsapp-cloud";
import {
  createMetaDeliveryLimit,
  isMetaDeliveryLimitError,
  META_DELIVERY_LIMIT_DISPLAY,
  withContactMetaDeliveryLimit,
  withMetaDeliveryLimitMetadata
} from "@/lib/meta-delivery-limit";
import { syncConversationWorkflowSignals } from "@/lib/conversation-workflow";

const MAX_DATABASE_MEDIA_BYTES = 16 * 1024 * 1024;

type MetaMedia = {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
  sha256?: string;
};

type MetaMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: MetaMedia;
  document?: MetaMedia;
  audio?: MetaMedia;
  video?: MetaMedia;
  sticker?: MetaMedia;
  referral?: { source_id?: string; source_type?: string };
};

type MetaStatus = {
  id?: string;
  status?: string;
  errors?: Array<{ code?: number | string; title?: string; message?: string; error_data?: { details?: string } }>;
};

type MetaChangeValue = {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
};

type MetaPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: MetaChangeValue;
    }>;
  }>;
};

function mapMetaStatus(status?: string) {
  if (status === "sent") return "SENT";
  if (status === "delivered") return "DELIVERED";
  if (status === "read") return "READ";
  if (status === "failed") return "FAILED";
  return null;
}

function messageBody(message: MetaMessage) {
  return (
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    message.image?.caption ??
    message.document?.caption ??
    message.video?.caption ??
    ""
  );
}

function fallbackMimeType(kind: string) {
  if (kind === "image" || kind === "sticker") return kind === "sticker" ? "image/webp" : "image/jpeg";
  if (kind === "audio") return "audio/ogg";
  if (kind === "video") return "video/mp4";
  return "application/octet-stream";
}

function extensionFromMime(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized === "application/pdf") return "pdf";
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  return normalized.split("/")[1]?.split(";")[0] || "file";
}

function mediaLabel(kind: string) {
  if (kind === "image" || kind === "sticker") return "Image";
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  return "Document";
}

function mediaFromMessage(message: MetaMessage) {
  const entries = [
    ["image", message.image],
    ["document", message.document],
    ["audio", message.audio],
    ["video", message.video],
    ["sticker", message.sticker]
  ] as const;
  const match = entries.find(([, media]) => media?.id);
  if (!match) return null;

  const [kind, media] = match;
  const mimeType = media?.mime_type || fallbackMimeType(kind);
  return {
    kind,
    media: media!,
    mimeType,
    messageType: messageTypeFromMime(mimeType),
    label: mediaLabel(kind)
  };
}

async function whatsappConfigForTenant(tenantId: string) {
  const integration = await prisma.integration.findUnique({
    where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } },
    select: { encryptedConfig: true, status: true }
  });
  if (integration?.status !== "CONNECTED") return null;
  return readEncryptedConfig(integration.encryptedConfig);
}

async function inboundMediaMetadata({
  tenantId,
  media,
  kind,
  mimeType
}: {
  tenantId: string;
  media: MetaMedia;
  kind: string;
  mimeType: string;
}) {
  const fileName = media.filename || `${mediaLabel(kind).toLowerCase()}-${media.id}.${extensionFromMime(mimeType)}`;
  const attachment: Record<string, unknown> = {
    id: media.id,
    whatsappMediaId: media.id,
    source: "whatsapp_inbound",
    mediaKind: kind,
    fileName,
    mimeType,
    sha256: media.sha256 ?? null
  };

  if (media.id) {
    try {
      const config = await whatsappConfigForTenant(tenantId);
      if (config) {
        const downloaded = await downloadWhatsAppMedia({ config, mediaId: media.id });
        attachment.mimeType = downloaded.mimeType;
        attachment.size = downloaded.size;
        attachment.sha256 = downloaded.sha256 ?? attachment.sha256;
        if (downloaded.bytes.byteLength <= MAX_DATABASE_MEDIA_BYTES) {
          attachment.dataUrl = `data:${downloaded.mimeType};base64,${downloaded.bytes.toString("base64")}`;
        } else {
          attachment.storageNote = "Media is larger than the database preview limit.";
        }
      }
    } catch (error) {
      attachment.downloadError = error instanceof Error ? error.message : "Unable to download WhatsApp media.";
    }
  }

  return {
    attachments: [attachment],
    whatsappMedia: {
      id: media.id,
      kind,
      mimeType,
      sha256: media.sha256 ?? null
    }
  };
}

function statusFailureReason(status: MetaStatus) {
  const error = status.errors?.[0];
  if (!error) return null;
  return [
    error.message,
    error.error_data?.details,
    error.title,
    error.code === undefined ? null : `code ${error.code}`
  ].filter(Boolean).join(" | ") || null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function metadataString(metadata: unknown, key: string) {
  const value = asRecord(metadata)[key];
  return typeof value === "string" ? value.trim() : "";
}

function metadataNumber(metadata: unknown, key: string) {
  const value = asRecord(metadata)[key];
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numberValue) ? numberValue : null;
}

async function updateLeadSheetStatusFromWebhook({
  tenantId,
  metadata,
  status
}: {
  tenantId: string;
  metadata: unknown;
  status: string;
}) {
  if (metadataString(metadata, "adapter") !== "lead-google-sheets-flow") return;

  const rowNumber = metadataNumber(metadata, "sheetRowNumber");
  const range = metadataString(metadata, "sheetRange") || "A:Z";
  let statusColumnIndex = metadataNumber(metadata, "sheetStatusColumnIndex");
  if (!rowNumber || rowNumber <= 0) return;

  const integration = await prisma.integration.findUnique({
    where: { tenantId_type: { tenantId, type: "GOOGLE_SHEETS" } },
    select: { status: true, encryptedConfig: true }
  });
  if (integration?.status !== "CONNECTED") return;

  const config = readEncryptedConfig(integration.encryptedConfig);
  if (statusColumnIndex === null || statusColumnIndex < 0) {
    const maxRows = Math.max(1000, rowNumber);
    const leads = await readGoogleSheetLeads({ config, range, maxRows });
    statusColumnIndex = leads.find((lead) => lead.rowNumber === rowNumber)?.statusColumnIndex ?? null;
  }
  if (statusColumnIndex === null || statusColumnIndex < 0) return;

  try {
    await updateGoogleSheetLeadStatuses({
      config,
      range,
      updates: [{ rowNumber, statusColumnIndex, status }]
    });
  } catch (error) {
    console.error("[webhook.sheets] lead status update failed", {
      tenantId,
      rowNumber,
      status,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function resolveTenantId({
  request,
  providedTenantId,
  phoneNumberId
}: {
  request: NextRequest;
  providedTenantId?: string;
  phoneNumberId?: string;
}) {
  const headerTenantId = request.headers.get("x-tenant-id") ?? undefined;
  const queryTenant = request.nextUrl.searchParams.get("tenant") ?? undefined;
  const tenantId = providedTenantId ?? headerTenantId ?? queryTenant;
  if (tenantId) {
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: tenantId }, { slug: tenantId }], status: "ACTIVE" }
    });
    if (tenant) {
      return tenant.id;
    }
  }

  if (!phoneNumberId) {
    throw new ApiError(400, "TENANT_NOT_RESOLVED", "Webhook tenant could not be resolved.");
  }

  const integrations = await prisma.integration.findMany({
    where: { type: "WHATSAPP_CLOUD", status: "CONNECTED" },
    select: { tenantId: true, encryptedConfig: true }
  });
  const match = integrations.find((integration) => {
    const config = readEncryptedConfig(integration.encryptedConfig);
    return config.WHATSAPP_PHONE_NUMBER_ID === phoneNumberId;
  });
  if (match) {
    return match.tenantId;
  }
  if (integrations.length === 1) {
    return integrations[0].tenantId;
  }

  throw new ApiError(400, "TENANT_NOT_RESOLVED", "Webhook phone number is not mapped to a connected tenant.");
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const tenantParam = searchParams.get("tenant");
  let expected = process.env.WHATSAPP_VERIFY_TOKEN ?? process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (tenantParam) {
    const tenant = await prisma.tenant.findFirst({ where: { OR: [{ id: tenantParam }, { slug: tenantParam }] } });
    if (tenant) {
      const integration = await prisma.integration.findUnique({
        where: { tenantId_type: { tenantId: tenant.id, type: "WHATSAPP_CLOUD" } },
        select: { encryptedConfig: true }
      });
      expected = readEncryptedConfig(integration?.encryptedConfig).WHATSAPP_VERIFY_TOKEN;
    }
  }

  if (mode === "subscribe" && challenge && expected && token === expected) {
    return new Response(challenge, { status: 200 });
  }

  return json({ error: { code: "WEBHOOK_VERIFICATION_FAILED", message: "Webhook verification failed" } }, { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const direct = whatsappWebhookMessageSchema.safeParse(raw);

    if (direct.success) {
      const tenantId = await resolveTenantId({ request, providedTenantId: direct.data.tenantId });
      const result = await upsertInboundConversationMessage({
        tenantId,
        phone: direct.data.from,
        name: direct.data.name,
        body: direct.data.body,
        messageId: direct.data.messageId,
        source: direct.data.source ?? "ORGANIC",
        sourceId: direct.data.sourceId
      });
      const workflowConversation = await syncConversationWorkflowSignals({
        tenantId,
        conversationId: result.conversation.id
      });

      const payload = {
        conversation: serializeConversation(workflowConversation ?? result.conversation),
        message: serializeMessage(result.message),
        scoring: result.scoring
      };
      if (!result.duplicate) {
        emitTenantEvent(tenantId, "message.created", payload);
        emitTenantEvent(tenantId, "conversation.updated", payload.conversation);
        emitTenantEvent(tenantId, "lead.temperature.updated", payload.scoring);
        await handleAiAgentInboundReply({ tenantId, conversationId: result.conversation.id }).catch((error) => {
          console.error("[webhook.ai-agent] failed", error instanceof Error ? error.message : String(error));
        });
      }
      return json({ ok: true, duplicate: result.duplicate });
    }

    const payload = raw as MetaPayload;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        const tenantId = await resolveTenantId({
          request,
          phoneNumberId: value.metadata?.phone_number_id
        });

        for (const status of value.statuses ?? []) {
          const mapped = mapMetaStatus(status.status);
          if (!status.id || !mapped) continue;
          const message = await prisma.message.findFirst({
            where: { whatsappMessageId: status.id },
            include: { contact: { select: { customFields: true } } }
          });
          if (!message) continue;
          const failureReason = statusFailureReason(status);
          const deliveryLimit =
            mapped === "FAILED" && isMetaDeliveryLimitError(status.errors?.[0] ?? failureReason)
              ? createMetaDeliveryLimit({ reason: failureReason })
              : null;
          const updated = await prisma.message.update({
            where: { id: message.id },
            data: {
              status: mapped,
              failureReason,
              ...(deliveryLimit
                ? {
                    metadata: withMetaDeliveryLimitMetadata(message.metadata, deliveryLimit) as Prisma.InputJsonValue
                  }
                : {})
            }
          });
          if (deliveryLimit) {
            await prisma.contact.update({
              where: { id: message.contactId },
              data: {
                customFields: withContactMetaDeliveryLimit(
                  message.contact.customFields,
                  deliveryLimit,
                  message.id
                ) as Prisma.InputJsonValue
              }
            });
          }
          const sheetStatus =
            deliveryLimit
              ? META_DELIVERY_LIMIT_DISPLAY
              : mapped === "FAILED"
                ? "failure"
                : mapped === "SENT" || mapped === "DELIVERED" || mapped === "READ"
                  ? "messaged"
                  : null;
          if (sheetStatus) {
            await updateLeadSheetStatusFromWebhook({
              tenantId: message.tenantId,
              metadata: updated.metadata,
              status: sheetStatus
            });
          }
          emitTenantEvent(message.tenantId, "message.status.updated", serializeMessage(updated));
        }

        for (const message of value.messages ?? []) {
          const media = mediaFromMessage(message);
          const body = messageBody(message) || media?.label || "";
          const from = message.from;
          if (!from || (!body && !media)) continue;
          const contact = value.contacts?.find((item) => item.wa_id === from);
          const mediaMetadata = media
            ? await inboundMediaMetadata({
                tenantId,
                media: media.media,
                kind: media.kind,
                mimeType: media.mimeType
              })
            : undefined;
          const result = await upsertInboundConversationMessage({
            tenantId,
            phone: from,
            waId: contact?.wa_id ?? from,
            name: contact?.profile?.name,
            body,
            messageId: message.id,
            type: media?.messageType ?? "TEXT",
            metadata: mediaMetadata,
            source: message.referral ? "AD" : "ORGANIC",
            sourceId: message.referral?.source_id
          });
          const workflowConversation = await syncConversationWorkflowSignals({
            tenantId,
            conversationId: result.conversation.id
          });
          const eventPayload = {
            conversation: serializeConversation(workflowConversation ?? result.conversation),
            message: serializeMessage(result.message),
            scoring: result.scoring
          };
          if (!result.duplicate) {
            emitTenantEvent(tenantId, "message.created", eventPayload);
            emitTenantEvent(tenantId, "conversation.updated", eventPayload.conversation);
            emitTenantEvent(tenantId, "lead.temperature.updated", eventPayload.scoring);
            await handleAiAgentInboundReply({ tenantId, conversationId: result.conversation.id }).catch((error) => {
              console.error("[webhook.ai-agent] failed", error instanceof Error ? error.message : String(error));
            });
          }
        }
      }
    }

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
