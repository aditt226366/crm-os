import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json } from "@/lib/api";
import { emitTenantEvent } from "@/lib/realtime";
import { readPlivoForm } from "@/lib/voice-agent";

// Plivo recording-ready callback. Stores the Plivo-hosted recording URL on the
// VoiceCall so the dashboard can play/download it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const form = await readPlivoForm(request);
    const callId = params.get("callId");
    const callUuid = form.CallUUID || "";
    const recordingUrl = form.RecordUrl || form.RecordingUrl || form.recording_url || "";
    const recordingDuration = Number.parseInt(form.RecordingDuration || form.Duration || "", 10);

    const voiceCall = callId
      ? await prisma.voiceCall.findUnique({ where: { id: callId } })
      : callUuid
        ? await prisma.voiceCall.findFirst({ where: { providerCallId: callUuid } })
        : null;
    if (!voiceCall || !recordingUrl) {
      return json({ ok: true });
    }

    const updated = await prisma.voiceCall.update({
      where: { id: voiceCall.id },
      data: {
        recordingUrl,
        ...(Number.isFinite(recordingDuration) && !voiceCall.durationSec ? { durationSec: recordingDuration } : {})
      }
    });

    emitTenantEvent(updated.tenantId, "voice.call.updated", { id: updated.id, recordingUrl });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
