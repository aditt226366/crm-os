import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json } from "@/lib/api";
import { emitTenantEvent } from "@/lib/realtime";
import { callIdFromRoomName, getLivekitWebhookReceiver, OUTBOUND_PARTICIPANT_PREFIX } from "@/lib/livekit-voice";

// LiveKit Cloud posts room/participant lifecycle events here. We use them to move
// an OUTBOUND VoiceCall through RINGING -> IN_PROGRESS (customer answered) ->
// COMPLETED / NO_ANSWER. The transcript + summary still come from the worker's
// /api/internal/voice/complete callback; this webhook mainly closes out calls
// that never connected. Outbound rooms are named voice-<callId> so we can map an
// event back to the call row (inbound terminal state comes from the worker).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const receiver = getLivekitWebhookReceiver();
  if (!receiver) return json({ ok: true });

  const body = await request.text();
  const authHeader = request.headers.get("Authorization") || "";

  let event;
  try {
    event = await receiver.receive(body, authHeader);
  } catch {
    return new Response("invalid signature", { status: 401 });
  }

  try {
    const roomName = event.room?.name ?? "";
    const callId = callIdFromRoomName(roomName);
    if (!callId) return json({ ok: true });

    const call = await prisma.voiceCall.findUnique({ where: { id: callId } });
    if (!call) return json({ ok: true });

    if (event.event === "participant_joined") {
      // The customer (SIP participant) answered — identity is pstn-<callId>.
      const identity = event.participant?.identity ?? "";
      if (identity.startsWith(OUTBOUND_PARTICIPANT_PREFIX) && call.status !== "IN_PROGRESS" && call.status !== "COMPLETED") {
        const updated = await prisma.voiceCall.update({
          where: { id: call.id },
          data: { status: "IN_PROGRESS", startedAt: call.startedAt ?? new Date() }
        });
        emitTenantEvent(updated.tenantId, "voice.call.updated", { id: updated.id, status: updated.status });
      }
    } else if (event.event === "room_finished") {
      // If the worker already completed the call (endedAt set), leave it alone.
      if (!call.endedAt) {
        const status = call.status === "IN_PROGRESS" ? "COMPLETED" : "NO_ANSWER";
        const updated = await prisma.voiceCall.update({
          where: { id: call.id },
          data: { status, endedAt: new Date() }
        });
        emitTenantEvent(updated.tenantId, "voice.call.updated", { id: updated.id, status: updated.status });
      }
    }

    return json({ ok: true });
  } catch (error) {
    console.error("[livekit.webhook] failed", error instanceof Error ? error.message : String(error));
    return json({ ok: true });
  }
}
