import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json, ApiError } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { loadVoiceAgentConfig } from "@/lib/voice-agent";
import { extractPdfText, fetchWebsiteText, storeKnowledgeDocument } from "@/lib/voice-knowledge";

// Tenant-user knowledge base for the Voice Agent: attach a website URL or a PDF.
// Text is extracted and stored as KnowledgeChunk rows so it actually reaches the
// agent's LLM (not just the filename).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function serializeDoc(doc: { id: string; title: string; type: string; status: string; updatedAt: Date }) {
  return { id: doc.id, title: doc.title, type: doc.type, status: doc.status, updatedAt: doc.updatedAt.toISOString() };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "VOICE_AGENTS");
    await ensureLeadWorkspaceSchema();
    const documents = await prisma.knowledgeDocument.findMany({
      where: { tenantId: user.tenantId!, status: { in: ["UPLOADED", "PROCESSING", "INDEXED"] } },
      select: { id: true, title: true, type: true, status: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 50
    });
    return json({ documents: documents.map(serializeDoc) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "VOICE_AGENTS");
    const tenantId = user.tenantId!;
    const form = await request.formData().catch(() => null);
    if (!form) {
      throw new ApiError(400, "INVALID_UPLOAD", "Send a website URL or a PDF file (multipart form).");
    }

    const url = typeof form.get("url") === "string" ? (form.get("url") as string).trim() : "";
    const file = form.get("file");

    // Website URL
    if (url) {
      if (!/^https?:\/\/\S+$/i.test(url)) {
        throw new ApiError(400, "INVALID_URL", "Enter a valid http(s) website URL.");
      }
      const text = await fetchWebsiteText(url);
      if (!text) {
        throw new ApiError(400, "WEBSITE_UNREADABLE", "Could not read that website. Check the URL is public and reachable.");
      }
      const document = await storeKnowledgeDocument({ tenantId, title: url, type: "URL", text, createdById: user.id });
      return json({ document: serializeDoc({ ...document }) }, { status: 201 });
    }

    // PDF upload
    if (file && typeof file !== "string") {
      const blob = file as File;
      if (!blob.name?.toLowerCase().endsWith(".pdf") && blob.type !== "application/pdf") {
        throw new ApiError(400, "INVALID_FILE", "Only PDF files are supported.");
      }
      if (blob.size > MAX_PDF_BYTES) {
        throw new ApiError(413, "FILE_TOO_LARGE", "PDF must be under 10 MB.");
      }
      const voice = await loadVoiceAgentConfig(tenantId);
      const apiKey = voice?.config?.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new ApiError(409, "VOICE_AGENT_NOT_CONFIGURED", "Ask your admin to connect the Voice Agent integration first.");
      }
      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      const text = await extractPdfText({ base64, apiKey, model: voice.config.LLM_MODEL || "claude-sonnet-4-6" });
      if (!text) {
        throw new ApiError(400, "PDF_UNREADABLE", "Could not extract text from that PDF.");
      }
      const document = await storeKnowledgeDocument({
        tenantId,
        title: blob.name || "document.pdf",
        type: "PDF",
        text,
        createdById: user.id
      });
      return json({ document: serializeDoc({ ...document }) }, { status: 201 });
    }

    throw new ApiError(400, "NOTHING_PROVIDED", "Provide a website URL or a PDF file.");
  } catch (error) {
    return errorResponse(error);
  }
}
