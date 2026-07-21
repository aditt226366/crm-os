import { AgentDispatchClient, SipClient, WebhookReceiver } from "livekit-server-sdk";

// LiveKit control-plane client. LiveKit Cloud runs the SIP bridging + real-time
// media; this module only (a) triggers outbound calls (dispatch our agent into a
// room, then dial the customer into it via the Plivo SIP outbound trunk) and
// (b) verifies inbound LiveKit webhooks. Project credentials are PLATFORM env
// (LiveKit Cloud is shared infra), not per-tenant.

const AGENT_NAME = process.env.VOICE_AGENT_NAME || "voice-inquiry-agent";

// The server SDK wants an http(s) host; the worker/browser use ws(s).
function livekitHost() {
  const raw = process.env.LIVEKIT_URL?.trim() || "";
  return raw
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/$/, "");
}

export function livekitConfigured() {
  return Boolean(
    process.env.LIVEKIT_URL &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET &&
      process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID
  );
}

// The LiveKit room name for a call encodes the callId so inbound LiveKit webhooks
// can map a finished room back to our VoiceCall row.
export function voiceRoomName(callId: string) {
  return `voice-${callId}`;
}

export function callIdFromRoomName(roomName: string) {
  return roomName.startsWith("voice-") ? roomName.slice("voice-".length) : null;
}

export const OUTBOUND_PARTICIPANT_PREFIX = "pstn-";

export async function placeOutboundCall({
  callId,
  token,
  toNumber,
  fromNumber,
  maxSeconds
}: {
  callId: string;
  token: string;
  toNumber: string;
  fromNumber: string;
  maxSeconds: number;
}): Promise<{ ok: boolean; roomName?: string; error?: string }> {
  if (!livekitConfigured()) {
    return { ok: false, error: "Voice calling is not configured yet (LiveKit project keys / outbound trunk missing)." };
  }

  const host = livekitHost();
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;
  const trunkId = process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID!;
  const roomName = voiceRoomName(callId);

  const dispatchClient = new AgentDispatchClient(host, apiKey, apiSecret);
  const sipClient = new SipClient(host, apiKey, apiSecret);

  try {
    // 1) Put our agent in the room first, so it is ready to greet the instant the
    //    customer answers. The token lets the worker fetch this call's context.
    await dispatchClient.createDispatch(roomName, AGENT_NAME, {
      metadata: JSON.stringify({ callId, token, direction: "OUTBOUND" })
    });
    // 2) Dial the customer into the same room via the Plivo outbound trunk. We do
    //    NOT wait for answer here (keeps the API route fast); call lifecycle is
    //    tracked via the LiveKit webhook + the worker's /complete callback.
    await sipClient.createSipParticipant(trunkId, toNumber, roomName, {
      fromNumber,
      participantIdentity: `${OUTBOUND_PARTICIPANT_PREFIX}${callId}`,
      participantName: "Customer",
      waitUntilAnswered: false,
      playDialtone: false,
      ...(maxSeconds > 0 ? { maxCallDuration: maxSeconds } : {})
    });
    return { ok: true, roomName };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "LiveKit could not place the call." };
  }
}

export function getLivekitWebhookReceiver() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return new WebhookReceiver(apiKey, apiSecret);
}
