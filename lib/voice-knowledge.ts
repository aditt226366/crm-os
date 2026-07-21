import { prisma } from "@/lib/prisma";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";

// Knowledge-base ingestion for the Voice Agent. Extracts real text (so it
// actually reaches the LLM via KnowledgeChunk rows — loadKnowledgeContext only
// surfaces chunk content, not filenames) with no new dependency:
//   - website: fetch + strip HTML
//   - PDF: Claude reads the document natively (uses the tenant's Anthropic key)

const MAX_KB_CHARS = 40_000;
const CHUNK_SIZE = 1_200;
const MAX_CHUNKS = 40;

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

export async function extractPdfText({
  base64,
  apiKey,
  model
}: {
  base64: string;
  apiKey: string;
  model: string;
}): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
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
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              {
                type: "text",
                text: "Extract all readable text from this document as plain text. Output only the extracted text, no commentary."
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as { content?: Array<{ text?: string }> } | null;
    const text = data?.content?.find((block) => block.text)?.text?.trim();
    return text ? text.slice(0, MAX_KB_CHARS) : null;
  } catch {
    return null;
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
  createdById
}: {
  tenantId: string;
  title: string;
  type: "URL" | "PDF";
  text: string;
  createdById?: string | null;
}) {
  await ensureLeadWorkspaceSchema();
  const document = await prisma.knowledgeDocument.create({
    data: {
      tenantId,
      title: title.slice(0, 200),
      type,
      status: "INDEXED",
      createdById: createdById ?? undefined,
      metadata: { source: "voice-agent" }
    }
  });
  const chunks = chunkText(text);
  if (chunks.length) {
    await prisma.knowledgeChunk.createMany({
      data: chunks.map((content) => ({ tenantId, documentId: document.id, content }))
    });
  }
  return document;
}
