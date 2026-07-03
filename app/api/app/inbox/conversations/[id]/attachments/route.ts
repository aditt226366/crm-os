import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { ApiError, errorResponse, json } from "@/lib/api";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { emitTenantEvent } from "@/lib/realtime";
import { recordUsage } from "@/lib/usage";
import { writeAuditLog } from "@/lib/audit";
import { readEncryptedConfig } from "@/lib/integration-vault";
import {
  messageTypeFromMime,
  sendWhatsAppMediaMessage,
  uploadWhatsAppMedia,
  whatsappMediaKindFromMime
} from "@/lib/whatsapp-cloud";

type Context = { params: Promise<{ id: string }> };

const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

function safeFileName(name: string) {
  const cleaned = name.replace(/[^\w.\- ()]/g, "_").trim();
  return cleaned || "attachment";
}

function attachmentPreviewBody(fileName: string, mimeType: string, caption: string) {
  if (caption) return caption;
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("audio/")) return "Audio";
  if (mimeType.startsWith("video/")) return "Video";
  return fileName;
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const tenantId = user.tenantId!;
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    const caption = String(formData.get("caption") ?? "").trim();

    if (!(file instanceof File)) {
      throw new ApiError(400, "ATTACHMENT_REQUIRED", "Please choose a file to send.");
    }
    if (file.size <= 0) {
      throw new ApiError(400, "ATTACHMENT_EMPTY", "The selected file is empty.");
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new ApiError(413, "ATTACHMENT_TOO_LARGE", "Attachments must be 16 MB or smaller.");
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId },
      include: { contact: true }
    });
    if (!conversation) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    if (conversation.contact.optOut) {
      throw new ApiError(403, "CONTACT_OPTED_OUT", "This contact opted out. Attachments are blocked.");
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

    const mimeType = file.type || "application/octet-stream";
    const fileName = safeFileName(file.name);
    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const uploadResult = await uploadWhatsAppMedia({
      config: readEncryptedConfig(integration.encryptedConfig),
      file: new Blob([arrayBuffer], { type: mimeType }),
      fileName,
      mimeType
    });
    const mediaKind = whatsappMediaKindFromMime(mimeType);
    const sendResult = uploadResult.mediaId
      ? await sendWhatsAppMediaMessage({
          config: readEncryptedConfig(integration.encryptedConfig),
          to: conversation.contact.phone,
          mediaId: uploadResult.mediaId,
          mediaType: mediaKind,
          caption,
          fileName
        })
      : {
          ok: false,
          status: uploadResult.status,
          whatsappMessageId: undefined,
          error: uploadResult.error ?? "WhatsApp media upload failed."
        };
    const failureReason = uploadResult.ok ? sendResult.error : uploadResult.error;
    const messageBody = attachmentPreviewBody(fileName, mimeType, caption);
    const metadata = {
      sentByUserId: user.id,
      adapter: "whatsapp-cloud-api",
      attachments: [
        {
          source: "manual_upload",
          fileName,
          mimeType,
          size: file.size,
          dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
          whatsappMediaId: uploadResult.mediaId ?? null,
          mediaKind
        }
      ]
    };

    const result = await createOutboundConversationMessage({
      tenantId,
      conversationId: id,
      body: messageBody,
      type: messageTypeFromMime(mimeType),
      whatsappMessageId: sendResult.whatsappMessageId,
      status: sendResult.ok ? "PENDING" : "FAILED",
      failureReason: failureReason ?? null,
      metadata
    });

    await recordUsage({
      tenantId,
      feature: "INBOX",
      provider: "meta",
      eventType: sendResult.ok ? "attachment.queued" : "attachment.failed",
      endpoint: `/api/app/inbox/conversations/${id}/attachments`,
      units: 1,
      cost: sendResult.ok ? 0.006 : 0,
      status: sendResult.ok ? "SUCCESS" : "FAILED",
      metadata: { messageId: result.message.id, failureReason: failureReason ?? null, mimeType, size: file.size }
    });

    await writeAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "inbox.attachment_queued",
      entityType: "Message",
      entityId: result.message.id,
      newValue: { fileName, mimeType, size: file.size }
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
