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

import httpx
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import anthropic, sarvam, silero

load_dotenv()

APP_URL = os.getenv("APP_URL", "http://127.0.0.1:3000").rstrip("/")
VOICE_SERVICE_SECRET = os.getenv("VOICE_SERVICE_SECRET", "")
AGENT_NAME = os.getenv("VOICE_AGENT_NAME", "voice-inquiry-agent")
STT_MODEL = os.getenv("SARVAM_STT_MODEL", "saarika:v2.5")
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

    token = metadata.get("token")
    if not token:
        # INBOUND: wait for the SIP caller, read the dialed/caller numbers from the
        # SIP attributes, and have the control plane resolve the tenant + create the
        # call row (returns callId + token).
        participant = await ctx.wait_for_participant()
        attributes = participant.attributes or {}
        dialed = _sip_attr(attributes, "sip.trunkPhoneNumber", "sip.toNumber", "sip.dialedNumber")
        caller = _sip_attr(attributes, "sip.phoneNumber", "sip.fromNumber")
        started = await start_inbound_call(dialed, caller)
        token = started.get("token")

    # Same context path for both directions.
    context = await fetch_context(token)

    speech = context.get("speech", {})
    llm_cfg = context.get("llm", {})
    greeting = context.get("greeting") or ""
    system_prompt = context.get("systemPrompt") or "You are a helpful inquiry agent."
    escalation_marker = context.get("escalationMarker", DEFAULT_ESCALATION_MARKER)
    language = speech.get("defaultLanguage", "en-IN")
    tts_language = speech.get("ttsLanguage") or language or "en-IN"
    speaker = speech.get("speaker") or "anushka"
    tts_model = speech.get("ttsModel") or TTS_MODEL

    session = AgentSession(
        stt=sarvam.STT(api_key=speech["sarvamApiKey"], model=STT_MODEL),
        llm=anthropic.LLM(api_key=llm_cfg["anthropicApiKey"], model=llm_cfg.get("model", "claude-sonnet-4-6")),
        tts=sarvam.TTS(
            api_key=speech["sarvamApiKey"],
            model=tts_model,
            target_language_code=tts_language,
            speaker=speaker,
        ),
        vad=ctx.proc.userdata["vad"],
    )

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

    await session.start(agent=Agent(instructions=system_prompt), room=ctx.room)

    # Make sure the caller has actually answered before greeting (outbound rings
    # until pickup; wait_for_participant returns immediately if already present).
    await ctx.wait_for_participant()

    if greeting:
        await session.say(greeting)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
        )
    )
