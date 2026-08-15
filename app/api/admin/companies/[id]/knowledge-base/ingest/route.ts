import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError, errorResponse, json } from "@/lib/api";
import { safeCreateAuditLog } from "@/lib/audit";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { readEncryptedConfig } from "@/lib/integration-vault";
import { extractPdfText, fetchWebsiteText, storeKnowledgeDocument } from "@/lib/knowledge-ingest";

// Admin-console knowledge base ingestion. The Knowledge Base card used to store
// only PDF_FILE_NAME / COMPANY_WEBSITE_URL metadata, so nothing ever reached the
// AI agent — loadKnowledgeContext reads KnowledgeChunk rows, and there were none.
// This route turns the uploaded PDF and the website into real chunks.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

type Context = { params: Promise<{ id: string }> };

/**
 * PDF text extraction runs on Claude's native document support, so it needs the
 * tenant's Anthropic key from the AI Model card.
 */
async function anthropicCredentials(tenantId: string) {
  const ai = await prisma.integration.findUnique({
    where: { tenantId_type: { tenantId, type: "AI_MODEL" } },
    select: { encryptedConfig: true }
  });
  const aiConfig = readEncryptedConfig(ai?.encryptedConfig);
  const aiKey = (aiConfig.AI_PROVIDER ?? "").trim().toUpperCase() === "ANTHROPIC" ? aiConfig.AI_API_KEY?.trim() : "";
  if (!aiKey) return null;
  return { apiKey: aiKey, model: aiConfig.AI_MODEL_NAME?.trim() || "claude-sonnet-4-6" };
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id: tenantId } = await context.params;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }
    await ensureIntegrationSchema();

    const form = await request.formData().catch(() => null);
    if (!form) {
      throw new ApiError(400, "INVALID_UPLOAD", "Send a website URL or a PDF file (multipart form).");
    }
    const url = typeof form.get("url") === "string" ? (form.get("url") as string).trim() : "";
    const file = form.get("file");
    const indexed: Array<{ title: string; type: string; chunkCount: number; truncated?: boolean }> = [];

    if (url) {
      if (!/^https?:\/\/\S+$/i.test(url)) {
        throw new ApiError(400, "INVALID_URL", "Enter a valid http(s) website URL.");
      }
      const text = await fetchWebsiteText(url);
      if (!text) {
        throw new ApiError(400, "WEBSITE_UNREADABLE", "Could not read that website. Check the URL is public and reachable.");
      }
      const stored = await storeKnowledgeDocument({
        tenantId,
        title: url,
        type: "URL",
        text,
        createdById: admin.id,
        source: "admin-console",
        replaceExisting: true
      });
      indexed.push({ title: url, type: "URL", chunkCount: stored.chunkCount });
    }

    if (file && typeof file !== "string") {
      const blob = file as File;
      if (!blob.name?.toLowerCase().endsWith(".pdf") && blob.type !== "application/pdf") {
        throw new ApiError(400, "INVALID_FILE", "Only PDF files are supported.");
      }
      if (blob.size > MAX_PDF_BYTES) {
        throw new ApiError(413, "FILE_TOO_LARGE", "PDF must be under 10 MB.");
      }
      const credentials = await anthropicCredentials(tenantId);
      if (!credentials) {
        throw new ApiError(
          409,
          "ANTHROPIC_KEY_MISSING",
          "PDF text extraction needs an Anthropic key. Connect the AI Model card with provider Anthropic first."
        );
      }
      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      const extraction = await extractPdfText({ base64, apiKey: credentials.apiKey, model: credentials.model });
      if (!extraction.ok) {
        // Report why. A bare "could not extract" leaves the admin with nothing
        // to act on, and the causes need different fixes (split the file, fix
        // the API key, re-scan an image-only PDF).
        throw new ApiError(400, "PDF_UNREADABLE", extraction.reason);
      }
      const title = blob.name || "document.pdf";
      const stored = await storeKnowledgeDocument({
        tenantId,
        title,
        type: "PDF",
        text: extraction.text,
        createdById: admin.id,
        source: "admin-console",
        replaceExisting: true
      });
      indexed.push({
        title,
        type: "PDF",
        chunkCount: stored.chunkCount,
        ...(extraction.truncated ? { truncated: true } : {})
      });
    }

    if (!indexed.length) {
      throw new ApiError(400, "NOTHING_PROVIDED", "Choose a PDF file or enter a company website URL first.");
    }

    await safeCreateAuditLog({
      request,
      actorUserId: admin.id,
      tenantId,
      action: "admin.knowledge_base_indexed",
      entityType: "KnowledgeDocument",
      entityId: tenantId,
      newValue: { indexed }
    });

    const totalChunks = indexed.reduce((total, entry) => total + entry.chunkCount, 0);
    const truncated = indexed.filter((entry) => entry.truncated).map((entry) => entry.title);
    return json({
      ok: true,
      indexed,
      message:
        `Indexed ${totalChunks} section${totalChunks === 1 ? "" : "s"} from ${indexed.map((entry) => entry.title).join(", ")}` +
        (truncated.length
          ? `. Warning: ${truncated.join(", ")} was too long to read in full — the end of the document is missing. Split it and upload the parts separately.`
          : "")
    });
  } catch (error) {
    return errorResponse(error);
  }
}
