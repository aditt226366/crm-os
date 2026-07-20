import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, json } from "@/lib/api";
import { emitTenantEvent } from "@/lib/realtime";
import { mapPlivoCallStatus, readPlivoForm, VOICE_TERMINAL_STATUSES } from "@/lib/voice-agent";

// Plivo call lifecycle callbacks (ringing / answered / hangup). Updates the
// VoiceCall status and duration. Identify the call by our ?callId= param when
// present (outbound + recording flows set it), else by the Plivo CallUUID.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const form = await readPlivoForm(request);
    const callUuid = form.CallUUID || "";
    const callId = params.get("callId");
    const status = mapPlivoCallStatus(form.CallStatus || form.Status || "");
    const duration = Number.parseInt(form.Duration || form.BillDuration || "", 10);

    const voiceCall = callId
      ? await prisma.voiceCall.findUnique({ where: { id: callId } })
      : callUuid
        ? await prisma.voiceCall.findFirst({ where: { providerCallId: callUuid } })
        : null;
    if (!voiceCall) {
      return json({ ok: true });
    }

    // Never downgrade a call the media service already marked COMPLETED.
    const keepStatus = voiceCall.status === "COMPLETED" && status !== "COMPLETED";
    const isTerminal = status ? VOICE_TERMINAL_STATUSES.includes(status) : false;

    const updated = await prisma.voiceCall.update({
      where: { id: voiceCall.id },
      data: {
        ...(status && !keepStatus ? { status } : {}),
        ...(Number.isFinite(duration) ? { durationSec: duration } : {}),
        providerCallId: voiceCall.providerCallId ?? (callUuid || null),
        ...(isTerminal && !voiceCall.endedAt ? { endedAt: new Date() } : {})
      }
    });

    emitTenantEvent(updated.tenantId, "voice.call.updated", {
      id: updated.id,
      status: updated.status,
      durationSec: updated.durationSec
    });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
