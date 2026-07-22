"""LiveKit Agents worker for the Voice Agent feature.

This replaces the old Pipecat media service. LiveKit Cloud runs the SIP bridging,
real-time media, and turn detection; this worker just joins each call's room and
runs an AgentSession wired to:

  Saarika STT (Sarvam)  ->  Claude (Anthropic)  ->  Bulbul TTS (Sarvam)

The conversation is turn-based automatically (LiveKit endpointing + VAD). The
agent speaks the configured greeting first via ``session.say()`` (deterministic,
instant, and recorded in the chat context), then listens.

Per-call config (credentials, greeting, system prompt with the embedded
knowledge base, escalation marker, TTS language/voice) comes from the control
plane, exactly like the Pipecat version:
  * OUTBOUND: the CRM dispatches this agent with metadata {callId, token,...};
    we GET /api/internal/voice/context with that token.
  * INBOUND:  LiveKit routes the SIP call here; we read the dialed/caller numbers
    from the SIP participant attributes and POST /api/internal/voice/inbound-start
    (shared-secret auth) to resolve the tenant + create the call row.

On hangup the transcript is POSTed to /api/internal/voice/complete, with a
needsSupport flag when the agent used the escalation line.

Verified against livekit-agents 1.6.x (see the plugin signatures in the repo
scratchpad introspection). If you bump the version, re-check AgentSession/say/
start and the sarvam/anthropic plugin constructors.
"""

import json
import os
import time
import traceback

import httpx
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, CloseReason, JobContext, WorkerOptions, cli
from livekit.plugins import anthropic, sarvam, silero

load_dotenv()

APP_URL = os.getenv("APP_URL", "http://127.0.0.1:3000").rstrip("/")
VOICE_SERVICE_SECRET = os.getenv("VOICE_SERVICE_SECRET", "")
AGENT_NAME = os.getenv("VOICE_AGENT_NAME", "voice-inquiry-agent")
STT_MODEL = os.getenv("SARVAM_STT_MODEL", "saaras:v3")
# bulbul:v2 + a female speaker (anushka) matches the known-good original config;
# /context can override the model, speaker, and language per tenant.
TTS_MODEL = os.getenv("SARVAM_TTS_MODEL", "bulbul:v2")
DEFAULT_ESCALATION_MARKER = "customer executive"


def prewarm(proc: agents.JobProcess):
    # Load the Silero VAD once per worker process and reuse it across calls.
    proc.userdata["vad"] = silero.VAD.load()


async def _get(url: str, headers: dict) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()


async def _post(url: str, headers: dict, payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()


async def fetch_context(token: str) -> dict:
    """Per-call context (creds, greeting, system prompt with embedded knowledge
    base, escalation marker, TTS hints) — same endpoint for inbound and outbound."""
    return await _get(
        f"{APP_URL}/api/internal/voice/context",
        {"Authorization": f"Bearer {token}"},
    )


async def start_inbound_call(dialed_number: str, from_number: str) -> dict:
    """Inbound only: resolve the tenant by the dialed number + create the call row.
    Returns {callId, token}; we then fetch_context(token) like an outbound call."""
    return await _post(
        f"{APP_URL}/api/internal/voice/inbound-start",
        {"Authorization": f"Bearer {VOICE_SERVICE_SECRET}"},
        {"dialedNumber": dialed_number, "fromNumber": from_number},
    )


async def post_complete(token: str, transcript: list, duration_sec: int, language: str, needs_support: bool):
    try:
        await _post(
            f"{APP_URL}/api/internal/voice/complete",
            {"Authorization": f"Bearer {token}"},
            {
                "transcript": transcript,
                "durationSec": duration_sec,
                "language": language,
                "needsSupport": needs_support,
                "status": "COMPLETED",
            },
        )
    except httpx.HTTPError as error:
        print(f"[complete] POST failed: {error}", flush=True)


def build_transcript(history) -> list:
    """Turn LiveKit's chat history into our transcript shape. The greeting was
    spoken with session.say(add_to_chat_ctx=True), so it is already an assistant
    turn in the history — no manual prepend needed."""
    turns = []
    for item in getattr(history, "items", []) or []:
        role = getattr(item, "role", None)
        if role not in ("user", "assistant"):
            continue
        text = (getattr(item, "text_content", None) or "").strip()
        if not text:
            continue
        turns.append({"role": "agent" if role == "assistant" else "customer", "text": text})
    return turns


def detect_support(turns: list, marker: str) -> bool:
    needle = (marker or DEFAULT_ESCALATION_MARKER).lower()
    return any(t["role"] == "agent" and needle in t["text"].lower() for t in turns)


def _sip_attr(attributes: dict, *keys: str) -> str:
    for key in keys:
        value = attributes.get(key)
        if value:
            return value
    return ""


async def entrypoint(ctx: JobContext):
    await ctx.connect()

    metadata = {}
    try:
        metadata = json.loads(ctx.job.metadata or "{}")
    except (TypeError, ValueError):
        metadata = {}

    # CRITICAL: wait for the caller/customer to be in the room BEFORE building and
    # starting the session. If session.start() runs first (outbound rings for a
    # while before pickup), RoomIO has no participant to subscribe to, so the STT
    # never receives the caller's audio — the agent stays deaf, transcribes
    # nothing, and the call eventually drops. Waiting first links both audio input
    # (STT) and output (TTS) to the caller.
    token = metadata.get("token")
    if not token:
        # INBOUND: read the dialed/caller numbers from the SIP participant
        # attributes, then have the control plane resolve the tenant + create the
        # call row (returns callId + token).
        participant = await ctx.wait_for_participant()
        attributes = participant.attributes or {}
        dialed = _sip_attr(attributes, "sip.trunkPhoneNumber", "sip.toNumber", "sip.dialedNumber")
        caller = _sip_attr(attributes, "sip.phoneNumber", "sip.fromNumber")
        started = await start_inbound_call(dialed, caller)
        token = started.get("token")
    else:
        # OUTBOUND: wait for the customer to answer (join the room) before starting.
        await ctx.wait_for_participant()

    # Same context path for both directions.
    context = await fetch_context(token)

    call_id = context.get("callId") or "unknown"
    speech = context.get("speech", {})
    llm_cfg = context.get("llm", {})
    greeting = context.get("greeting") or ""
    system_prompt = context.get("systemPrompt") or "You are a helpful inquiry agent."
    escalation_marker = context.get("escalationMarker", DEFAULT_ESCALATION_MARKER)
    language = speech.get("defaultLanguage", "en-IN")
    tts_language = speech.get("ttsLanguage") or language or "en-IN"
    speaker = speech.get("speaker") or "anushka"
    tts_model = speech.get("ttsModel") or TTS_MODEL

    # Sarvam's LiveKit STT plugin does its OWN endpointing and only emits
    # end-of-speech when flush_signal=True AND the session uses
    # turn_detection="stt". Passing a competing Silero VAD with no turn_detection
    # (the old config) meant the caller's turn never ended -> the LLM was never
    # called -> the agent went silent and the call timed out. This is Sarvam's
    # documented working LiveKit config.
    session = AgentSession(
        stt=sarvam.STT(
            api_key=speech["sarvamApiKey"],
            model=STT_MODEL,
            language="unknown",  # auto-detect English / Hindi / Tamil
            mode="transcribe",
            flush_signal=True,
        ),
        llm=anthropic.LLM(api_key=llm_cfg["anthropicApiKey"], model=llm_cfg.get("model", "claude-sonnet-4-6")),
        tts=sarvam.TTS(
            api_key=speech["sarvamApiKey"],
            model=tts_model,
            target_language_code=tts_language,
            speaker=speaker,
        ),
        turn_detection="stt",
        min_endpointing_delay=0.07,
    )

    # The pipeline runs entirely inside AgentSession's internal tasks — an STT/LLM/
    # TTS exception does NOT raise out of session.start()/say(); it surfaces only
    # as an "error" event, and the session then closes with reason=ERROR. Without
    # these handlers a mid-call crash is completely silent in the logs (this is
    # exactly the kind of bug that caused the earlier Pipecat cut-call issues to
    # be hard to diagnose) — so log both explicitly.
    @session.on("error")
    def _on_error(ev):
        print(
            f"[call] session ERROR call={call_id} source={ev.source} error={ev.error!r}",
            flush=True,
        )

    @session.on("close")
    def _on_close(ev):
        detail = f" error={ev.error!r}" if ev.reason == CloseReason.ERROR else ""
        print(f"[call] session CLOSE call={call_id} reason={ev.reason.value}{detail}", flush=True)

    started = time.monotonic()

    async def write_transcript(*_args):
        transcript = build_transcript(session.history)
        needs_support = detect_support(transcript, escalation_marker)
        duration = int(time.monotonic() - started)
        if token:
            await post_complete(token, transcript, duration, language, needs_support)
        print(
            f"[call] ended turns={len(transcript)} duration={duration}s needs_support={needs_support}",
            flush=True,
        )

    ctx.add_shutdown_callback(write_transcript)

    try:
        # The participant is already present (waited for above), so the session
        # links STT input + TTS output to the caller on start.
        await session.start(agent=Agent(instructions=system_prompt), room=ctx.room)

        if greeting:
            await session.say(greeting)
    except Exception:
        print(f"[call] entrypoint crashed call={call_id}\n{traceback.format_exc()}", flush=True)
        raise


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
        )
    )
