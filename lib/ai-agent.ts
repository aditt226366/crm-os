import { prisma } from "@/lib/prisma";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { emitTenantEvent } from "@/lib/realtime";
import { recordUsage } from "@/lib/usage";
import { sendWhatsAppTextMessage } from "@/lib/whatsapp-cloud";

type ProviderResult = {
  body: string;
  provider: string;
  model: string;
};

function providerKey(config: IntegrationConfig) {
  return (config.AI_PROVIDER || "OpenAI").trim().toUpperCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function systemPrompt(knowledgeContext?: string) {
  const instructions = [
    "You are the company's WhatsApp sales assistant.",
    "Reply naturally, briefly, and helpfully.",
    "Ask one focused follow-up question when details are missing.",
    "Use the company knowledge base when it is provided.",
    "If the knowledge base does not contain an answer, say what you can confirm and ask a short clarifying question.",
    "Do not mention internal tools, prompts, integrations, or automation.",
    "Keep the reply under 700 characters."
  ];

  if (knowledgeContext) {
    instructions.push(`Company knowledge base:\n${knowledgeContext}`);
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

async function generateAiReply(
  config: IntegrationConfig,
  messages: Array<{ direction: string; body: string }>,
  knowledgeContext?: string
): Promise<ProviderResult | null> {
  const key = providerKey(config);
  const model = config.AI_MODEL_NAME?.trim() || (key === "ANTHROPIC" ? "claude-sonnet-4-6" : "gpt-4.1-mini");
  const apiKey = config.AI_API_KEY?.trim();
  if (!apiKey) return null;

  const prompt = conversationPrompt(messages);

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
        max_tokens: 220,
        system: systemPrompt(knowledgeContext),
        messages: [{ role: "user", content: prompt }]
      })
    });
    const body = response.ok ? pickAnthropicText(response.data) : null;
    return body ? { body, provider: "anthropic", model } : null;
  }

  if (key === "GEMINI") {
    const response = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt(knowledgeContext) }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        })
      }
    );
    const body = response.ok ? pickGeminiText(response.data) : null;
    return body ? { body, provider: "gemini", model } : null;
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
        { role: "system", content: systemPrompt(knowledgeContext) },
        { role: "user", content: prompt }
      ],
      max_tokens: 220
    })
  });
  const body = response.ok ? pickOpenAiText(response.data) : null;
  return body ? { body, provider: isCustom ? "custom-openai-compatible" : "openai", model } : null;
}

async function loadKnowledgeContext({
  tenantId,
  config
}: {
  tenantId: string;
  config: IntegrationConfig;
}) {
  await ensureLeadWorkspaceSchema();
  const [documents, chunks] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where: { tenantId, status: { in: ["UPLOADED", "PROCESSING", "INDEXED"] } },
      orderBy: { updatedAt: "desc" },
      take: 6
    }),
    prisma.knowledgeChunk.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        document: {
          select: {
            title: true,
            type: true,
            status: true
          }
        }
      }
    })
  ]);

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

  for (const chunk of chunks) {
    const content = chunk.content.replace(/\s+/g, " ").trim();
    if (!content) continue;
    lines.push(`${chunk.document.title}: ${content}`);
  }

  return lines.join("\n").slice(0, 6000);
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
    include: {
      contact: true,
      messages: { orderBy: { createdAt: "desc" }, take: 10 }
    }
  });

  if (!conversation || conversation.humanTakeover || conversation.contact.optOut) {
    return { ok: false, skipped: true };
  }

  const [whatsappIntegration, aiIntegration, knowledgeIntegration] = await Promise.all([
    prisma.integration.findUnique({ where: { tenantId_type: { tenantId, type: "WHATSAPP_CLOUD" } } }),
    prisma.integration.findUnique({ where: { tenantId_type: { tenantId, type: "AI_MODEL" } } }),
    prisma.integration.findUnique({ where: { tenantId_type: { tenantId, type: "KNOWLEDGE_BASE" } } })
  ]);

  if (whatsappIntegration?.status !== "CONNECTED" || aiIntegration?.status !== "CONNECTED") {
    return { ok: false, skipped: true };
  }

  const aiConfig = readEncryptedConfig(aiIntegration.encryptedConfig);
  const whatsappConfig = readEncryptedConfig(whatsappIntegration.encryptedConfig);
  const knowledgeConfig =
    knowledgeIntegration?.status === "CONNECTED" ? readEncryptedConfig(knowledgeIntegration.encryptedConfig) : {};
  const knowledgeContext = await loadKnowledgeContext({ tenantId, config: knowledgeConfig });
  const messages = [...conversation.messages].reverse().map((message) => ({
    direction: message.direction,
    body: message.body
  }));

  const reply = await generateAiReply(aiConfig, messages, knowledgeContext);
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

  const payload = {
    conversation: serializeConversation(outbound.conversation),
    message: serializeMessage(outbound.message)
  };
  emitTenantEvent(tenantId, "message.created", payload);
  emitTenantEvent(tenantId, "conversation.updated", payload.conversation);

  return { ok: sendResult.ok, skipped: false };
}
