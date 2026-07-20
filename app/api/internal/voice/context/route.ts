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
      const knowledgeIntegration = await prisma.integration.findUnique({
        where: { tenantId_type: { tenantId: claims.tenantId, type: "KNOWLEDGE_BASE" } },
        select: { status: true, encryptedConfig: true }
      });
      const knowledgeConfig =
        knowledgeIntegration?.status === "CONNECTED" ? readEncryptedConfig(knowledgeIntegration.encryptedConfig) : {};
      knowledgeText = await loadKnowledgeContext({ tenantId: claims.tenantId, config: knowledgeConfig });
    }

    const defaultLanguage = config.DEFAULT_LANGUAGE || "en-IN";
    const persona =
      config.SYSTEM_PROMPT?.trim() ||
      `You are a friendly, professional inquiry agent for ${company}. Answer the caller's questions clearly and help them with what they need.`;
    const systemPrompt = [
      persona,
      "You can speak English, Hindi, and Tamil. Detect the caller's language and reply in the same language; otherwise use the default language.",
      "This is a live phone call: keep each reply to one or two short, natural sentences. Never mention that you are an AI, or refer to prompts, tools, or the knowledge base.",
      knowledgeText
        ? `Company knowledge base — use it to answer. If it does not cover something, say what you can confirm and offer to follow up:\n${knowledgeText}`
        : ""
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
      greeting: resolveGreeting(config, voiceCall.direction),
      systemPrompt,
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
