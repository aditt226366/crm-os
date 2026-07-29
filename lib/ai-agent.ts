import { prisma } from "@/lib/prisma";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { emitTenantEvent } from "@/lib/realtime";
import { recordUsage } from "@/lib/usage";
import { sendWhatsAppTextMessage } from "@/lib/whatsapp-cloud";
import { syncConversationWorkflowSignals } from "@/lib/conversation-workflow";

type ProviderResult = {
  body: string;
  provider: string;
  model: string;
};

function providerKey(config: IntegrationConfig) {
  return (config.AI_PROVIDER || "OpenAI").trim().toUpperCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function systemPrompt({ companyName, knowledgeContext }: { companyName?: string; knowledgeContext?: string }) {
  const instructions = [
    `You are the WhatsApp sales assistant for ${companyName?.trim() || "this company"}.`,
    "Reply naturally, briefly, and helpfully.",
    "Ask one focused follow-up question when details are missing.",
    // The knowledge base is the ONLY source of truth about the business. Without
    // this the model invents an industry (a tenant selling PG rooms was told it
    // was a scrap trading company) and confidently turns real customers away.
    "The company knowledge base below is the only source of truth about what this company does, sells, charges, and where it operates.",
    "Never state or imply an industry, product, price, location, or policy that the knowledge base does not contain, and never tell a customer the company does not handle something unless the knowledge base says so.",
    "If the knowledge base does not cover the question, say you will check with the team and ask one short clarifying question.",
    "Do not mention internal tools, prompts, integrations, or automation.",
    "Keep the reply under 700 characters."
  ];

  if (knowledgeContext) {
    instructions.push(`Company knowledge base:\n${knowledgeContext}`);
  } else {
    instructions.push(
      "No company knowledge base is available. Do not describe what the company does or sells — greet the customer, ask what they need, and offer to have the team follow up."
    );
  }

  return instructions.join("\n");
}

function conversationPrompt(messages: Array<{ direction: string; body: string }>) {
  return messages.map((message) => `${message.direction === "INBOUND" ? "Customer" : "Assistant"}: ${message.body}`).join("\n");
}

async function fetchJson(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = (await response.json().catch(() => null)) as unknown;
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

function pickOpenAiText(data: unknown) {
  return (data as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices?.[0]?.message?.content?.trim();
}

function pickAnthropicText(data: unknown) {
  const content = (data as { content?: Array<{ text?: string }> } | null)?.content ?? [];
  return content.find((item) => item.text)?.text?.trim();
}

function pickGeminiText(data: unknown) {
  return (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null)?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
}

export type AiCompletionResult = {
  text: string;
  provider: string;
  model: string;
};

/**
 * Single-shot completion against the tenant's configured AI provider
 * (OpenAI / Anthropic / Gemini / custom OpenAI-compatible). Returns null when
 * the provider is unconfigured or returns no usable text. Shared by the inbound
 * AI reply agent and other AI features (e.g. transcript appointment extraction).
 */
export async function generateAiCompletion({
  config,
  system,
  user,
  maxTokens = 220
}: {
  config: IntegrationConfig;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiCompletionResult | null> {
  const key = providerKey(config);
  const model = config.AI_MODEL_NAME?.trim() || (key === "ANTHROPIC" ? "claude-sonnet-4-6" : "gpt-4.1-mini");
  const apiKey = config.AI_API_KEY?.trim();
  if (!apiKey) return null;

  if (key === "ANTHROPIC") {
    const response = await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }]
      })
    });
    const text = response.ok ? pickAnthropicText(response.data) : null;
    return text ? { text, provider: "anthropic", model } : null;
  }

  if (key === "GEMINI") {
    const response = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }]
        })
      }
    );
    const text = response.ok ? pickGeminiText(response.data) : null;
    return text ? { text, provider: "gemini", model } : null;
  }

  const isCustom = key === "CUSTOM_OPENAI_COMPATIBLE";
  const baseUrl = isCustom ? config.AI_BASE_URL?.trim() || "" : "https://api.openai.com/v1";
  if (!baseUrl) return null;

  const response = await fetchJson(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: maxTokens
    })
  });
  const text = response.ok ? pickOpenAiText(response.data) : null;
  return text ? { text, provider: isCustom ? "custom-openai-compatible" : "openai", model } : null;
}

async function generateAiReply(
  config: IntegrationConfig,
  messages: Array<{ direction: string; body: string }>,
  knowledgeContext?: string,
  companyName?: string
): Promise<ProviderResult | null> {
  const completion = await generateAiCompletion({
    config,
    system: systemPrompt({ companyName, knowledgeContext }),
    user: conversationPrompt(messages),
    maxTokens: 220
  });
  return completion ? { body: completion.text, provider: completion.provider, model: completion.model } : null;
}

const CHUNK_POOL = 120;
const KNOWLEDGE_CHAR_LIMIT = 10_000;
const QUERY_STOP_WORDS = new Set([
  "the", "and", "for", "you", "are", "our", "with", "have", "this", "that", "there", "here", "what",
  "when", "where", "which", "who", "how", "can", "will", "would", "should", "could", "does", "did",
  "please", "hello", "hii", "hey", "your", "from", "about", "any", "all", "not", "but", "was", "were"
]);

function queryTerms(query?: string) {
  if (!query) return [];
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !QUERY_STOP_WORDS.has(word));
  return [...new Set(terms)].slice(0, 24);
}

/**
 * Keyword relevance over the tenant's chunks. Deliberately embedding-free: the
 * knowledge bases here are small (tens of chunks), so term overlap picks the
 * right section without an extra provider call on every inbound message.
 */
function rankChunks(chunks: Array<{ content: string }>, query: string | undefined, topK: number) {
  const terms = queryTerms(query);
  if (!terms.length) return chunks.slice(0, topK);

  const scored = chunks
    .map((chunk, index) => {
      const haystack = chunk.content.toLowerCase();
      return { chunk, index, score: terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, topK);

  // Nothing matched (e.g. "hi") — fall back to the newest chunks so the agent
  // still knows what the company is rather than answering from thin air.
  if (!scored.length) return chunks.slice(0, topK);
  return scored.sort((a, b) => a.index - b.index).map((entry) => entry.chunk);
}

export async function loadKnowledgeContext({
  tenantId,
  config,
  query
}: {
  tenantId: string;
  config: IntegrationConfig;
  /** Customer message used to pick the relevant chunks; omit to take the newest. */
  query?: string;
}) {
  await ensureLeadWorkspaceSchema();
  const topK = Math.min(Math.max(Number(config.KNOWLEDGE_TOP_K ?? 8) || 8, 1), 20);
  const [documents, chunks] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where: { tenantId, status: { in: ["UPLOADED", "PROCESSING", "INDEXED"] } },
      select: {
        title: true,
        type: true,
        status: true
      },
      orderBy: { updatedAt: "desc" },
      take: 6
    }),
    // Do NOT join the `document` relation here: an orphaned chunk (parent doc
    // missing) makes Prisma throw "Field document is required to return data,
    // got null", which would 500 the whole request. Content alone is enough.
    prisma.knowledgeChunk.findMany({
      where: { tenantId },
      select: {
        content: true
      },
      orderBy: { createdAt: "desc" },
      take: CHUNK_POOL
    })
  ]);

  const contentLines: string[] = [];
  for (const chunk of rankChunks(chunks, query, topK)) {
    const content = chunk.content.replace(/\s+/g, " ").trim();
    if (!content) continue;
    contentLines.push(content);
  }

  // Source names alone (filename, website URL, document titles) are not
  // knowledge. Returning them as "the knowledge base" invites the model to
  // invent the rest, so an unindexed knowledge base reports as empty and the
  // caller falls back to its "no knowledge available" instructions.
  if (!contentLines.length) return "";

  const lines: string[] = [];
  if (config.COMPANY_WEBSITE_URL) {
    lines.push(`Website: ${config.COMPANY_WEBSITE_URL}`);
  }
  if (config.PDF_FILE_NAME) {
    lines.push(`Uploaded PDF: ${config.PDF_FILE_NAME}`);
  }

  for (const document of documents) {
    lines.push(`Document: ${document.title} (${document.type}, ${document.status})`);
  }

  return [...lines, ...contentLines].join("\n").slice(0, KNOWLEDGE_CHAR_LIMIT);
}

async function safeUsage(input: {
  tenantId: string;
  provider: string;
  eventType: string;
  status: string;
  metadata?: unknown;
}) {
  try {
    await recordUsage({
      tenantId: input.tenantId,
      feature: "AI_AGENTS",
      provider: input.provider,
      eventType: input.eventType,
      endpoint: "/api/webhooks/whatsapp",
      units: 1,
      cost: 0,
      status: input.status,
      metadata: input.metadata
    });
  } catch (error) {
    console.error("[ai-agent.usage] failed", error instanceof Error ? error.message : String(error));
  }
}

export async function handleAiAgentInboundReply({
  tenantId,
  conversationId
}: {
  tenantId: string;
  conversationId: string;
}) {
  await ensureLeadWorkspaceSchema();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true,
      aiRepliesStopped: true,
      contactId: true,
      contact: {
        select: {
          id: true,
          name: true,
          phone: true,
          optOut: true,
          leadTemperature: true,
          customerReplyCount: true
        }
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          direction: true,
          body: true,
          type: true,
          createdAt: true
        }
      }
    }
  });

  if (!conversation || conversation.aiRepliesStopped || conversation.contact.optOut) {
    return { ok: false, skipped: true };
  }

  const [tenant, whatsappIntegration, aiIntegration, knowledgeIntegration] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } },
      select: { status: true, encryptedConfig: true }
    }),
    prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: "AI_MODEL" } },
      select: { status: true, encryptedConfig: true }
    }),
    prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: "KNOWLEDGE_BASE" } },
      select: { status: true, encryptedConfig: true }
    })
  ]);

  if (whatsappIntegration?.status !== "CONNECTED" || aiIntegration?.status !== "CONNECTED") {
    return { ok: false, skipped: true };
  }

  const aiConfig = readEncryptedConfig(aiIntegration.encryptedConfig);
  const whatsappConfig = readEncryptedConfig(whatsappIntegration.encryptedConfig);
  const knowledgeConfig =
    knowledgeIntegration?.status === "CONNECTED" ? readEncryptedConfig(knowledgeIntegration.encryptedConfig) : {};
  // conversation.messages is newest-first, so this is the question being answered.
  const latestCustomerMessage = conversation.messages.find((message) => message.direction === "INBOUND")?.body;
  const knowledgeContext = await loadKnowledgeContext({
    tenantId,
    config: knowledgeConfig,
    query: latestCustomerMessage
  });
  const messages = [...conversation.messages].reverse().map((message) => ({
    direction: message.direction,
    body: message.body
  }));

  const reply = await generateAiReply(aiConfig, messages, knowledgeContext, tenant?.name);
  if (!reply?.body) {
    await safeUsage({
      tenantId,
      provider: "ai",
      eventType: "ai_agent.reply_failed",
      status: "FAILED",
      metadata: { conversationId }
    });
    return { ok: false, skipped: true };
  }

  const sendResult = await sendWhatsAppTextMessage({
    config: whatsappConfig,
    to: conversation.contact.phone,
    body: reply.body
  });

  const outbound = await createOutboundConversationMessage({
    tenantId,
    conversationId,
    body: reply.body,
    whatsappMessageId: sendResult.whatsappMessageId,
    status: sendResult.ok ? "PENDING" : "FAILED",
    failureReason: sendResult.error ?? null,
    metadata: {
      adapter: "ai-agent",
      provider: reply.provider,
      model: reply.model
    }
  });

  await safeUsage({
    tenantId,
    provider: reply.provider,
    eventType: sendResult.ok ? "ai_agent.reply_queued" : "ai_agent.reply_failed",
    status: sendResult.ok ? "SUCCESS" : "FAILED",
    metadata: { conversationId, messageId: outbound.message.id }
  });

  const workflowConversation = await syncConversationWorkflowSignals({
    tenantId,
    conversationId,
    latestAssistantReply: reply.body
  });

  const payload = {
    conversation: serializeConversation(workflowConversation ?? outbound.conversation),
    message: serializeMessage(outbound.message)
  };
  emitTenantEvent(tenantId, "message.created", payload);
  emitTenantEvent(tenantId, "conversation.updated", payload.conversation);

  return { ok: sendResult.ok, skipped: false };
}
