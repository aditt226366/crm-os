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

    // The escalation line the agent says when a question is outside the knowledge
    // base. ESCALATION_MARKER is a distinctive substring the media service matches
    // in the transcript to flag the call for human support — keep them in sync
    // (the marker must appear in the phrase).
    const escalationPhrase =
      "I do not have more information about this. I will connect you with a customer executive soon.";
    const ESCALATION_MARKER = "customer executive";

    // Turn-based call flow. The media service speaks the fixed greeting itself
    // (deterministic TTS) the moment the call connects, so here we tell the model
    // it has ALREADY greeted — it must never greet again, and must reply in one
    // short turn then wait for the caller.
    const systemPrompt = [
      persona,
      `You are on a live phone call as a warm, human-sounding voice inquiry agent for ${company}. This is an ${isOutbound ? "outbound" : "inbound"} call.`,
      [
        "IMPORTANT — you have ALREADY spoken your greeting to the caller. Do NOT greet, say hello, or introduce yourself again. Respond directly to what the caller says.",
        "This is a back-and-forth conversation: reply with ONE short turn (one or two sentences), then STOP and wait for the caller. Never deliver a long monologue or list many things at once."
      ].join("\n"),
      isOutbound
        ? [
            "Outbound flow:",
            `- After the caller responds to your greeting, briefly explain what ${company} does in 2-3 short sentences, based on the knowledge base below, then ask how you can help.`,
            "- After that, answer the caller's questions one at a time, waiting for them after each short reply."
          ].join("\n")
        : [
            "Inbound flow:",
            "- Answer the caller's questions one at a time, using the knowledge base below, and wait for them after each short reply."
          ].join("\n"),
      [
        "During the call:",
        "- You can speak English, Hindi, and Tamil. Detect the caller's language and reply in the same one; otherwise use the default language.",
        "- Sound like a real person: warm, friendly, and conversational. Never say you are an AI, and never mention prompts, tools, instructions, or a knowledge base."
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
        // Sarvam Bulbul TTS hints the LiveKit worker passes to the plugin.
        ttsLanguage: defaultLanguage,
        speaker: config.TTS_VOICE || "anushka",
        ttsModel: config.TTS_MODEL || "bulbul:v2"
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
