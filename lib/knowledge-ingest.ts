import { prisma } from "@/lib/prisma";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";

// Knowledge-base ingestion for the admin console Knowledge Base card. Extracts
// real text (so it actually reaches the LLM via KnowledgeChunk rows —
// loadKnowledgeContext only surfaces chunk content, not filenames) with no new
// dependency:
//   - website: fetch + strip HTML
//   - PDF: Claude reads the document natively (uses the tenant's Anthropic key)

// A real knowledge base is a long document. The old 40k/40-chunk ceiling held
// roughly 12 pages, so anything larger was silently cut off — the agent would
// answer confidently from the first third and know nothing about the rest.
const MAX_KB_CHARS = 200_000;
const CHUNK_SIZE = 1_200;
const MAX_CHUNKS = 200;
// Output cap for extraction. 8k tokens is about a third of a 23-page document,
// and the truncation was invisible.
const EXTRACTION_MAX_TOKENS = 32_000;
const EXTRACTION_TIMEOUT_MS = 240_000;

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchWebsiteText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { headers: { Accept: "text/html,text/plain" }, signal: controller.signal });
    if (!response.ok) return null;
    const text = stripHtml(await response.text());
    return text.length >= 20 ? text.slice(0, MAX_KB_CHARS) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export type PdfExtractionResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: string };

/**
 * Reads a PDF via Claude's native document support.
 *
 * Returns a reason on failure rather than null. The previous version collapsed
 * an API error, a timeout and an empty response into the same `null`, which
 * surfaced to the admin as a bare "Could not extract text from that PDF" with
 * nothing to act on.
 */
export async function extractPdfText({
  base64,
  apiKey,
  model
}: {
  base64: string;
  apiKey: string;
  model: string;
}): Promise<PdfExtractionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: EXTRACTION_MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              {
                type: "text",
                text: "Extract all readable text from this document as plain text, preserving headings, tables as readable lines, and ordering. Output only the extracted text, no commentary."
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    });

    const data = (await response.json().catch(() => null)) as {
      content?: Array<{ text?: string }>;
      stop_reason?: string;
      error?: { message?: string; type?: string };
    } | null;

    if (!response.ok) {
      const detail = data?.error?.message ?? data?.error?.type ?? "no detail returned";
      return { ok: false, reason: `Claude rejected the document (HTTP ${response.status}): ${detail}` };
    }

    const text = data?.content?.find((block) => block.text)?.text?.trim();
    if (!text) {
      return { ok: false, reason: "Claude returned no text for this PDF — it may be an image-only scan." };
    }

    return {
      ok: true,
      text: text.slice(0, MAX_KB_CHARS),
      // Either the model hit its output cap or we clipped it; both mean the
      // tail of the document is missing and the admin should know.
      truncated: data?.stop_reason === "max_tokens" || text.length > MAX_KB_CHARS
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted
        ? `Extraction timed out after ${Math.round(EXTRACTION_TIMEOUT_MS / 1000)}s — the PDF is large. Split it into smaller files and upload them one at a time.`
        : `Extraction failed: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function chunkText(text: string) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length && chunks.length < MAX_CHUNKS; index += CHUNK_SIZE) {
    const piece = text.slice(index, index + CHUNK_SIZE).trim();
    if (piece) chunks.push(piece);
  }
  return chunks;
}

export async function storeKnowledgeDocument({
  tenantId,
  title,
  type,
  text,
  createdById,
  source = "admin-console",
  replaceExisting = false
}: {
  tenantId: string;
  title: string;
  type: "URL" | "PDF";
  text: string;
  createdById?: string | null;
  source?: string;
  /** Drop earlier versions of the same source so re-uploads replace, not stack. */
  replaceExisting?: boolean;
}) {
  await ensureLeadWorkspaceSchema();
  const documentTitle = title.slice(0, 200);
  if (replaceExisting) {
    await prisma.knowledgeDocument.deleteMany({ where: { tenantId, title: documentTitle } });
  }
  const document = await prisma.knowledgeDocument.create({
    data: {
      tenantId,
      title: documentTitle,
      type,
      status: "INDEXED",
      createdById: createdById ?? undefined,
      metadata: { source }
    }
  });
  const chunks = chunkText(text);
  if (chunks.length) {
    await prisma.knowledgeChunk.createMany({
      data: chunks.map((content) => ({ tenantId, documentId: document.id, content }))
    });
  }
  return { document, chunkCount: chunks.length };
}
