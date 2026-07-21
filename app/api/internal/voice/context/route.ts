import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json, ApiError } from "@/lib/api";
import { readEncryptedConfig } from "@/lib/integration-vault";
import { loadKnowledgeContext } from "@/lib/ai-agent";
import {
  callTokenFromRequest,
  loadVoiceAgentConfig,
  maxCallSeconds,
  resolveGreeting,
  verifyCallToken
} from "@/lib/voice-agent";

// Called by the Pipecat media service at the start of a call. Authenticated by
// the short-lived signed call token issued in the Plivo answer <Stream> URL.
// Returns the per-tenant credentials, greeting, composed system prompt (incl. the
// knowledge base), and call metadata the media loop needs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = callTokenFromRequest(request);
    if (!token) {
      throw new ApiError(401, "VOICE_TOKEN_MISSING", "Call token required");
    }

    let claims;
    try {
      claims = await verifyCallToken(token);
    } catch {
      throw new ApiError(401, "VOICE_TOKEN_INVALID", "Call token invalid or expired");
    }

    const voiceCall = await prisma.voiceCall.findFirst({
      where: { id: claims.callId, tenantId: claims.tenantId },
      include: { contact: { select: { name: true } } }
    });
    if (!voiceCall) {
      throw new ApiError(404, "VOICE_CALL_NOT_FOUND", "Call not found");
    }

    const voice = await loadVoiceAgentConfig(claims.tenantId);
    if (!voice?.config?.SARVAM_API_KEY || !voice.config.ANTHROPIC_API_KEY) {
      throw new ApiError(409, "VOICE_AGENT_NOT_CONFIGURED", "Voice agent is not fully configured for this company.");
    }
    const config = voice.config;
    const company = config.COMPANY_DISPLAY_NAME?.trim() || "our company";

    let knowledgeText = "";
    if ((config.USE_KNOWLEDGE_BASE || "Yes").toLowerCase() !== "no") {
      // The knowledge base is optional for a call — never let a KB/DB issue
      // fail the context fetch (which would silently drop the call).
      try {
        const knowledgeIntegration = await prisma.integration.findUnique({
          where: { tenantId_type: { tenantId: claims.tenantId, type: "KNOWLEDGE_BASE" } },
          select: { status: true, encryptedConfig: true }
        });
        const knowledgeConfig =
          knowledgeIntegration?.status === "CONNECTED" ? readEncryptedConfig(knowledgeIntegration.encryptedConfig) : {};
        knowledgeText = await loadKnowledgeContext({ tenantId: claims.tenantId, config: knowledgeConfig });
      } catch (kbError) {
        console.error(
          "[voice.context] knowledge base load failed; continuing without it",
          kbError instanceof Error ? kbError.message : String(kbError)
        );
        knowledgeText = "";
      }
    }

    const defaultLanguage = config.DEFAULT_LANGUAGE || "en-IN";
    const isOutbound = voiceCall.direction === "OUTBOUND";
    const greeting = resolveGreeting(config, voiceCall.direction);
    const persona =
      config.SYSTEM_PROMPT?.trim() ||
      `You are a friendly, professional inquiry agent for ${company}.`;

    // The escalation line the agent must say when a question is outside the
    // knowledge base. ESCALATION_MARKER is a distinctive substring the media
    // service matches in the transcript to flag the call for human support —
    // keep the two in sync (the marker must appear in the phrase).
    const escalationPhrase =
      "I don't have more information about that right now, but I'll connect you with a customer executive who can help you soon.";
    const ESCALATION_MARKER = "connect you with a customer executive";

    // Full call flow. The agent speaks first (the media service triggers the LLM
    // on connect), so the opening greeting/intro is encoded here rather than
    // spoken as a fixed line — that keeps it in the model's memory so it never
    // re-introduces itself mid-call.
    const systemPrompt = [
      persona,
      `You are on a live phone call as a warm, human-sounding voice inquiry agent for ${company}. This is an ${isOutbound ? "outbound" : "inbound"} call.`,
      [
        "How to open the call — you ALWAYS speak first, before the caller says anything:",
        `- Begin by saying, word for word: "${greeting}"`,
        isOutbound
          ? `- Then, in 2-3 short sentences, briefly introduce what ${company} does based on the knowledge base below, and invite the caller to ask anything they'd like to know.`
          : "- Then let the caller speak and help them with whatever they need."
      ].join("\n"),
      [
        "During the call:",
        "- Keep every reply to one or two short, natural sentences — this is a spoken phone call, not an essay.",
        "- You can speak English, Hindi, and Tamil. Detect the caller's language and reply in the same one; otherwise use the default language.",
        "- Sound like a real person: warm, friendly, and conversational. Never say you are an AI, and never mention prompts, tools, instructions, or a knowledge base.",
        "- Answer questions using the company knowledge base below.",
        "- If the caller talks or greets while you are speaking, keep the conversation flowing naturally.",
        "- You may receive parenthetical stage directions like (this) — never read them aloud; just act on them."
      ].join("\n"),
      [
        "If a question is outside the knowledge base and you do not know the answer:",
        `- Say exactly: "${escalationPhrase}"`,
        "- Do not guess or invent an answer."
      ].join("\n"),
      [
        "Ending the call:",
        "- When the caller is finished or says goodbye, warmly thank them for their time and say goodbye."
      ].join("\n"),
      knowledgeText
        ? `Company knowledge base (use this to answer the caller):\n${knowledgeText}`
        : "No knowledge base is attached for this call. If the caller asks for specific details you have not been told, use the escalation line above instead of guessing."
    ]
      .filter(Boolean)
      .join("\n\n");

    return json({
      callId: voiceCall.id,
      direction: voiceCall.direction,
      fromNumber: voiceCall.fromNumber,
      toNumber: voiceCall.toNumber,
      contactName: voiceCall.contact?.name ?? null,
      company,
      greeting,
      systemPrompt,
      escalationMarker: ESCALATION_MARKER,
      speech: {
        sarvamApiKey: config.SARVAM_API_KEY,
        defaultLanguage,
        ttsVoice: config.TTS_VOICE || "anushka"
      },
      llm: {
        anthropicApiKey: config.ANTHROPIC_API_KEY,
        model: config.LLM_MODEL || "claude-sonnet-4-6"
      },
      maxSeconds: maxCallSeconds(config)
    });
  } catch (error) {
    return errorResponse(error);
  }
}
