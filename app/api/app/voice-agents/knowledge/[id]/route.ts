import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json, ApiError } from "@/lib/api";
import { requireFeature } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Remove an attached knowledge-base document (and its chunks cascade).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireFeature(request, "VOICE_AGENTS");
    const { id } = await params;
    const doc = await prisma.knowledgeDocument.findFirst({ where: { id, tenantId: user.tenantId! }, select: { id: true } });
    if (!doc) {
      throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    }
    await prisma.knowledgeDocument.delete({ where: { id: doc.id } });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
