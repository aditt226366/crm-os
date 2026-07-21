import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { loadVoiceAgentConfig, serializeVoiceCall, VOICE_LANGUAGES } from "@/lib/voice-agent";

// Dashboard payload for the Voice Agents page: agent/connection summary (no
// secrets), knowledge-base documents, headline metrics, and recent calls.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "VOICE_AGENTS");
    const tenantId = user.tenantId!;
    await ensureIntegrationSchema();

    const [voice, knowledgeDocuments, calls, total, completed, inbound] = await Promise.all([
      loadVoiceAgentConfig(tenantId),
      prisma.knowledgeDocument.findMany({
        where: { tenantId, status: { in: ["UPLOADED", "PROCESSING", "INDEXED"] } },
        select: { id: true, title: true, type: true, status: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 20
      }),
      prisma.voiceCall.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { contact: { select: { name: true } } }
      }),
      prisma.voiceCall.count({ where: { tenantId } }),
      prisma.voiceCall.count({ where: { tenantId, status: "COMPLETED" } }),
      prisma.voiceCall.count({ where: { tenantId, direction: "INBOUND" } })
    ]);

    const config = voice?.config;
    const connected = voice?.status === "CONNECTED";

    return json({
      agent: {
        connected,
        status: voice?.status ?? "NOT_CONNECTED",
        // Non-secret display fields only.
        virtualNumber: config?.PLIVO_PHONE_NUMBER ?? null,
        companyName: config?.COMPANY_DISPLAY_NAME ?? user.tenant?.name ?? "",
        outboundGreeting: config?.OUTBOUND_GREETING ?? "",
        inboundGreeting: config?.INBOUND_GREETING ?? "",
        systemPrompt: config?.SYSTEM_PROMPT ?? "",
        maxCallSeconds: Number(config?.MAX_CALL_SECONDS ?? 300) || 300,
        defaultLanguage: config?.DEFAULT_LANGUAGE ?? "en-IN",
        ttsVoice: config?.TTS_VOICE ?? "anushka",
        useKnowledgeBase: (config?.USE_KNOWLEDGE_BASE ?? "Yes").toLowerCase() !== "no",
        languages: [...VOICE_LANGUAGES],
        voice: "Female",
        role: "Inquiry agent"
      },
      knowledgeDocuments: knowledgeDocuments.map((doc) => ({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        status: doc.status,
        updatedAt: doc.updatedAt.toISOString()
      })),
      metrics: {
        total,
        completed,
        inbound,
        outbound: total - inbound
      },
      calls: calls.map((call) => serializeVoiceCall(call))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
