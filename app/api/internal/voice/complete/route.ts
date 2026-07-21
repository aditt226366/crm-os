import { NextRequest } from "next/server";
import type { Prisma, VoiceCallStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { errorResponse, json, ApiError } from "@/lib/api";
import { generateAiCompletion } from "@/lib/ai-agent";
import { emitTenantEvent } from "@/lib/realtime";
import { recordUsage } from "@/lib/usage";
import { callTokenFromRequest, loadVoiceAgentConfig, verifyCallToken } from "@/lib/voice-agent";

// Called by the Pipecat media service when a call ends. Saves the transcript,
// duration, and detected language, then generates a short post-call summary with
// Claude (reusing generateAiCompletion). Authenticated by the signed call token.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TranscriptTurn = { role: string; text: string; lang?: string; tsMs?: number };

const ALLOWED_STATUSES = new Set<VoiceCallStatus>(["COMPLETED", "FAILED", "NO_ANSWER"]);

function sanitizeTranscript(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const turn = entry as Record<string, unknown>;
      const role = turn.role === "agent" || turn.role === "customer" ? turn.role : "customer";
      const text = typeof turn.text === "string" ? turn.text.trim() : "";
      const lang = typeof turn.lang === "string" ? turn.lang : undefined;
      const tsMs = typeof turn.tsMs === "number" ? turn.tsMs : undefined;
      return { role, text, lang, tsMs };
    })
    .filter((turn) => turn.text.length > 0)
    .slice(0, 500);
}

function transcriptToText(turns: TranscriptTurn[]) {
  return turns.map((turn) => `${turn.role === "agent" ? "Agent" : "Customer"}: ${turn.text}`).join("\n");
}

// Fire-and-forget: summarize the call with Claude and store it. The media service
// does not wait on this.
async function generateCallSummary({ tenantId, callId, transcriptText }: { tenantId: string; callId: string; transcriptText: string }) {
  try {
    if (!transcriptText.trim()) return;
    const voice = await loadVoiceAgentConfig(tenantId);
    const apiKey = voice?.config?.ANTHROPIC_API_KEY;
    if (!apiKey) return;
    const completion = await generateAiCompletion({
      config: {
        AI_PROVIDER: "Anthropic",
        AI_MODEL_NAME: voice?.config?.LLM_MODEL || "claude-sonnet-4-6",
        AI_API_KEY: apiKey
      },
      system:
        "You summarize a phone call for a CRM. In 2-3 short sentences, capture the caller's intent, any questions they asked, and any follow-up needed. Plain text only.",
      user: transcriptText,
      maxTokens: 200
    });
    if (completion?.text) {
      await prisma.voiceCall.update({ where: { id: callId }, data: { summary: completion.text } });
      emitTenantEvent(tenantId, "voice.call.updated", { id: callId, summary: completion.text });
    }
  } catch (error) {
    console.error("[voice.summary] failed", error instanceof Error ? error.message : String(error));
  }
}

export async function POST(request: NextRequest) {
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
      select: { id: true, tenantId: true, direction: true, endedAt: true, metadata: true }
    });
    if (!voiceCall) {
      throw new ApiError(404, "VOICE_CALL_NOT_FOUND", "Call not found");
    }

    const body = (await request.json().catch(() => ({}))) as {
      transcript?: unknown;
      durationSec?: unknown;
      language?: unknown;
      status?: unknown;
      error?: unknown;
      needsSupport?: unknown;
    };

    const transcript = sanitizeTranscript(body.transcript);
    const durationSec = Number.isFinite(Number(body.durationSec)) ? Math.max(0, Math.trunc(Number(body.durationSec))) : null;
    const language = typeof body.language === "string" ? body.language : null;
    const requestedStatus = typeof body.status === "string" ? (body.status as VoiceCallStatus) : "COMPLETED";
    const status: VoiceCallStatus = ALLOWED_STATUSES.has(requestedStatus) ? requestedStatus : "COMPLETED";
    const errorMessage = typeof body.error === "string" ? body.error.slice(0, 500) : null;
    const needsSupport = body.needsSupport === true;

    // Merge the support flag into metadata so we do not clobber values stored at
    // dial time (e.g. requestUuid). No schema migration needed — metadata is JSON.
    const existingMetadata =
      voiceCall.metadata && typeof voiceCall.metadata === "object" && !Array.isArray(voiceCall.metadata)
        ? (voiceCall.metadata as Record<string, unknown>)
        : {};
    const metadata = { ...existingMetadata, needsSupport };

    const updated = await prisma.voiceCall.update({
      where: { id: voiceCall.id },
      data: {
        transcript: transcript as unknown as Prisma.InputJsonValue,
        ...(durationSec !== null ? { durationSec } : {}),
        ...(language ? { language } : {}),
        ...(errorMessage ? { errorMessage } : {}),
        status,
        metadata: metadata as Prisma.InputJsonValue,
        endedAt: voiceCall.endedAt ?? new Date()
      }
    });

    emitTenantEvent(updated.tenantId, "voice.call.updated", {
      id: updated.id,
      status: updated.status,
      durationSec: updated.durationSec,
      needsSupport,
      hasTranscript: transcript.length > 0
    });

    recordUsage({
      tenantId: updated.tenantId,
      feature: "VOICE_AGENTS",
      provider: "plivo",
      eventType: "voice.call.completed",
      endpoint: "/api/internal/voice/complete",
      units: 1,
      cost: 0,
      status: status === "COMPLETED" ? "SUCCESS" : "FAILED",
      metadata: { callId: updated.id, direction: updated.direction, turns: transcript.length }
    }).catch(() => {});

    // Summarize without blocking the media service's completion request.
    void generateCallSummary({ tenantId: updated.tenantId, callId: updated.id, transcriptText: transcriptToText(transcript) });

    return json({ ok: true, callId: updated.id });
  } catch (error) {
    return errorResponse(error);
  }
}
