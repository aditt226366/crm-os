import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json, ApiError } from "@/lib/api";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { emitTenantEvent } from "@/lib/realtime";
import { callTokenFromRequest, resolveVoiceTenantByNumber, signCallToken } from "@/lib/voice-agent";

// Called by the LiveKit worker at the start of an INBOUND call (LiveKit routed a
// SIP call to the agent). Authenticated by the shared VOICE_SERVICE_SECRET.
// Resolves the tenant that owns the dialed number, creates the VoiceCall row, and
// returns { callId, token } so the worker then GETs /context with that token —
// exactly the same context path outbound calls use.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.VOICE_SERVICE_SECRET;
    const provided = callTokenFromRequest(request);
    if (!secret || !provided || provided !== secret) {
      throw new ApiError(401, "VOICE_UNAUTHORIZED", "Invalid service credentials.");
    }
    await ensureIntegrationSchema();

    const body = (await request.json().catch(() => ({}))) as { dialedNumber?: unknown; fromNumber?: unknown };
    const dialedNumber = typeof body.dialedNumber === "string" ? body.dialedNumber.trim() : "";
    const fromNumber = typeof body.fromNumber === "string" ? body.fromNumber.trim() : "";
    if (!dialedNumber) {
      throw new ApiError(400, "VOICE_DIALED_NUMBER_MISSING", "Dialed number is required.");
    }

    const tenantId = await resolveVoiceTenantByNumber(dialedNumber);
    if (!tenantId) {
      throw new ApiError(404, "VOICE_TENANT_NOT_FOUND", "No voice agent is configured for this number.");
    }

    // Best-effort contact match by the caller's trailing 10 digits (same as the
    // old inbound answer webhook).
    const last10 = fromNumber.replace(/\D/g, "").slice(-10);
    const contact = last10
      ? await prisma.contact.findFirst({ where: { tenantId, last10 }, select: { id: true } })
      : null;

    const voiceCall = await prisma.voiceCall.create({
      data: {
        tenantId,
        direction: "INBOUND",
        status: "IN_PROGRESS",
        fromNumber: fromNumber || "unknown",
        toNumber: dialedNumber,
        contactId: contact?.id ?? null,
        startedAt: new Date()
      }
    });

    emitTenantEvent(tenantId, "voice.call.updated", {
      id: voiceCall.id,
      status: voiceCall.status,
      direction: voiceCall.direction
    });

    const token = await signCallToken({ callId: voiceCall.id, tenantId });
    return json({ callId: voiceCall.id, token });
  } catch (error) {
    return errorResponse(error);
  }
}
