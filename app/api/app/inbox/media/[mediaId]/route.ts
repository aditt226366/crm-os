import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { readEncryptedConfig } from "@/lib/integration-vault";
import { downloadWhatsAppMedia } from "@/lib/whatsapp-cloud";

// Streams inbound WhatsApp media (customer photos, PDFs) to the inbox.
//
// Served from MessageMedia when we hold the bytes, which is the normal case and
// the reason attachments stay viewable forever. Falls back to fetching from Meta
// for anything received before media was stored, or too large to store — those
// only work inside Meta's ~30 day retention window.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ mediaId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { user } = await requireFeature(request, "INBOX");
    const tenantId = user.tenantId!;
    const { mediaId } = await context.params;
    if (!mediaId?.trim()) {
      throw new ApiError(400, "MEDIA_ID_REQUIRED", "Media id is required.");
    }

    // MessageMedia is created by the runtime bootstrap, not a migration, so it
    // may not exist yet on a database that predates this feature.
    await ensureLeadWorkspaceSchema();

    // Stored copy first — this is scoped to the tenant by the unique key, so it
    // doubles as the ownership check.
    const stored = await prisma.messageMedia.findUnique({
      where: { tenantId_whatsappMediaId: { tenantId, whatsappMediaId: mediaId } },
      select: { data: true, mimeType: true, fileName: true }
    });
    if (stored) {
      return mediaResponse(stored.data, stored.mimeType);
    }

    // A media id is only fetchable by the tenant that received it. Without this
    // check the route would hand any signed-in user any tenant's attachments,
    // since Meta media ids are the only thing identifying the file.
    const owner = await prisma.message.findFirst({
      where: { tenantId, metadata: { path: ["whatsappMedia", "id"], equals: mediaId } },
      select: { id: true }
    });
    if (!owner) {
      throw new ApiError(404, "MEDIA_NOT_FOUND", "That attachment does not belong to this company.");
    }

    const integration = await prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } },
      select: { status: true, encryptedConfig: true }
    });
    if (integration?.status !== "CONNECTED") {
      throw new ApiError(409, "WHATSAPP_NOT_CONNECTED", "Connect WhatsApp Cloud API to view attachments.");
    }

    const downloaded = await downloadWhatsAppMedia({
      config: readEncryptedConfig(integration.encryptedConfig),
      mediaId
    });

    return mediaResponse(downloaded.bytes, downloaded.mimeType);
  } catch (error) {
    return errorResponse(error);
  }
}

function mediaResponse(bytes: Buffer | Uint8Array, mimeType: string) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      // Inline so images and PDFs open in the browser instead of downloading.
      "Content-Disposition": "inline",
      // Media is immutable once received; let the browser keep it so scrolling
      // the thread does not re-fetch every image. Private: it is tenant data.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
