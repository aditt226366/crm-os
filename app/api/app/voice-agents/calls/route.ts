import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json, ApiError } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { recordUsage } from "@/lib/usage";
import { emitTenantEvent } from "@/lib/realtime";
import { makeOutboundCall, normalizePlivoNumber } from "@/lib/plivo-voice";
import { appBaseUrl, loadVoiceAgentConfig, serializeVoiceCall } from "@/lib/voice-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validPhone(value: string) {
  return /^\+?\d{7,15}$/.test(value.replace(/[\s-]/g, ""));
}

// GET: paginated call history for the tenant (used for polling / refresh).
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "VOICE_AGENTS");
    const tenantId = user.tenantId!;
    const take = Math.min(Math.max(Number(request.nextUrl.searchParams.get("take") ?? 50) || 50, 1), 100);

    const calls = await prisma.voiceCall.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take,
      include: { contact: { select: { name: true } } }
    });

    return json({ calls: calls.map((call) => serializeVoiceCall(call)) });
  } catch (error) {
    return errorResponse(error);
  }
}

// POST: place an outbound call. Creates a VoiceCall row then asks Plivo to dial.
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "VOICE_AGENTS");
    const tenantId = user.tenantId!;
    await ensureIntegrationSchema();

    const body = (await request.json().catch(() => ({}))) as {
      to?: unknown;
      contactId?: unknown;
      language?: unknown;
    };
    const contactId = typeof body.contactId === "string" ? body.contactId : null;
    const language = typeof body.language === "string" ? body.language : null;

    const voice = await loadVoiceAgentConfig(tenantId);
    if (voice?.status !== "CONNECTED" || !voice.config.PLIVO_PHONE_NUMBER) {
      throw new ApiError(409, "VOICE_AGENT_NOT_CONNECTED", "Connect the Voice Agent integration before placing calls.");
    }

    let toNumber = typeof body.to === "string" ? body.to.trim() : "";
    let contact: { id: string; phone: string } | null = null;
    if (contactId) {
      contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId }, select: { id: true, phone: true } });
      if (!contact) {
        throw new ApiError(404, "CONTACT_NOT_FOUND", "Contact not found");
      }
      toNumber = toNumber || contact.phone;
    }

    if (!toNumber || !validPhone(toNumber)) {
      throw new ApiError(400, "INVALID_PHONE", "A valid destination phone number is required.");
    }

    const voiceCall = await prisma.voiceCall.create({
      data: {
        tenantId,
        direction: "OUTBOUND",
        status: "QUEUED",
        fromNumber: voice.config.PLIVO_PHONE_NUMBER,
        toNumber: normalizePlivoNumber(toNumber),
        contactId: contact?.id ?? null,
        language,
        createdById: user.id
      },
      include: { contact: { select: { name: true } } }
    });

    const origin = appBaseUrl(request.nextUrl.origin);
    const answerUrl = `${origin}/api/webhooks/plivo/answer?callId=${encodeURIComponent(voiceCall.id)}`;
    const hangupUrl = `${origin}/api/webhooks/plivo/status?callId=${encodeURIComponent(voiceCall.id)}`;

    const result = await makeOutboundCall({ config: voice.config, to: toNumber, answerUrl, hangupUrl });

    if (!result.ok) {
      const failed = await prisma.voiceCall.update({
        where: { id: voiceCall.id },
        data: { status: "FAILED", errorMessage: result.error ?? "Plivo call failed.", endedAt: new Date() },
        include: { contact: { select: { name: true } } }
      });
      emitTenantEvent(tenantId, "voice.call.updated", { id: failed.id, status: failed.status });
      throw new ApiError(502, "PLIVO_CALL_FAILED", result.error ?? "Plivo could not place the call.");
    }

    const ringing = await prisma.voiceCall.update({
      where: { id: voiceCall.id },
      data: {
        status: "RINGING",
        metadata: result.requestUuid ? { requestUuid: result.requestUuid } : undefined
      },
      include: { contact: { select: { name: true } } }
    });

    emitTenantEvent(tenantId, "voice.call.updated", { id: ringing.id, status: ringing.status });
    recordUsage({
      tenantId,
      feature: "VOICE_AGENTS",
      provider: "plivo",
      eventType: "voice.call.placed",
      endpoint: "/api/app/voice-agents/calls",
      units: 1,
      cost: 0,
      status: "SUCCESS",
      metadata: { callId: ringing.id }
    }).catch(() => {});

    return json({ call: serializeVoiceCall(ringing) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
