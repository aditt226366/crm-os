"""Pipecat pipeline for a single voice call.

Pipeline: Plivo audio (8kHz) -> Saarika STT (Sarvam) -> Claude Sonnet -> Bulbul
TTS (Sarvam) -> Plivo audio, with Silero VAD and interruptions.

Conversation design (this is the important part):
  The agent ALWAYS speaks first. On connect we push a hidden "call started" cue
  into the LLM context and fire an LLMRunFrame, so Claude generates the opening
  turn itself (greeting, plus a short company intro on outbound calls). Because
  the opening is produced by the LLM, it lands in the conversation memory via the
  assistant aggregator -- so when the caller replies, Claude already knows it has
  greeted and continues naturally instead of re-introducing itself.

  Everything after that is a normal STT -> LLM -> TTS loop. The full call flow
  (exact greeting, outbound company intro, answer-from-knowledge-base, the
  out-of-scope escalation line, and the closing thank-you) is encoded in the
  system prompt built by the control plane at /api/internal/voice/context.

  When Claude uses the escalation line ("...connect you with a customer
  executive..."), we detect it in the transcript and report needsSupport=true so
  the dashboard can flag the call for a human follow-up.

Targets the current Pipecat API: universal LLMContext + LLMContextAggregatorPair,
the websocket.fastapi transport, and LLMRunFrame to drive the bot-speaks-first
opening. If you pin a very different pipecat-ai version and hit an ImportError,
check the module paths in the imports block against your installed version.
"""

import asyncio
import os
import time

import httpx
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndFrame, LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.serializers.plivo import PlivoFrameSerializer
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport

# --- Pipecat services (version-sensitive imports) ---------------------------
from pipecat.services.anthropic.llm import AnthropicLLMService
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService

STT_MODEL = os.getenv("SARVAM_STT_MODEL", "saarika:v2.5")
TTS_MODEL = os.getenv("SARVAM_TTS_MODEL", "bulbul:v2")

# Hidden stage cue that makes Claude produce the opening turn without waiting for
# the caller. It is a parenthetical stage direction; the system prompt tells the
# model never to read cues aloud, and we strip it from the saved transcript.
CALL_START_CUE = "(The phone call just connected. You are the agent — deliver your opening now.)"

# Default substring used to detect the escalation line in an agent turn. The
# control plane can override it via the context payload so the two stay in sync.
DEFAULT_ESCALATION_MARKER = "connect you with a customer executive"


async def post_complete(
    app_url: str,
    token: str,
    transcript: list,
    duration_sec: int,
    language: str,
    needs_support: bool,
    status: str = "COMPLETED",
):
    """Send the finished transcript back to the control plane."""
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            await client.post(
                f"{app_url}/api/internal/voice/complete",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "transcript": transcript,
                    "durationSec": duration_sec,
                    "language": language,
                    "needsSupport": needs_support,
                    "status": status,
                },
            )
        except httpx.HTTPError as error:
            logger.error(f"complete POST failed: {error}")


def _message_text(content) -> str:
    """Universal LLMContext message content can be a string or a list of parts."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                parts.append(part.get("text", ""))
            else:
                parts.append(getattr(part, "text", "") or "")
        return " ".join(p for p in parts if p).strip()
    return ""


def _extract_transcript(context) -> list:
    """Best-effort transcript from the LLM context after the call ends. Skips the
    system prompt and the hidden call-start cue; keeps only real user/assistant
    turns, labelled agent/customer."""
    turns = []

    messages = []
    getter = getattr(context, "get_messages", None)
    if callable(getter):
        try:
            messages = getter() or []
        except Exception:
            messages = []
    if not messages:
        messages = getattr(context, "messages", []) or []

    for message in messages:
        if isinstance(message, dict):
            role = message.get("role")
            content = message.get("content")
        else:
            role = getattr(message, "role", None)
            content = getattr(message, "content", None)
        if role not in ("user", "assistant"):
            continue
        text = _message_text(content)
        if not text:
            continue
        # Drop the hidden opening cue we injected to make the bot speak first.
        if text == CALL_START_CUE:
            continue
        turns.append({"role": "agent" if role == "assistant" else "customer", "text": text})
    return turns


def _detect_support(turns: list, marker: str) -> bool:
    """True if the agent used the out-of-scope escalation line during the call."""
    needle = (marker or DEFAULT_ESCALATION_MARKER).lower()
    for turn in turns:
        if turn.get("role") == "agent" and needle in turn.get("text", "").lower():
            return True
    return False


async def run_bot(websocket, token: str, app_url: str, stream_id: str, call_id: str | None, context: dict):
    speech = context.get("speech", {})
    llm_cfg = context.get("llm", {})
    default_language = speech.get("defaultLanguage", "en-IN")
    system_prompt = context.get("systemPrompt", "You are a helpful inquiry agent.")
    escalation_marker = context.get("escalationMarker", DEFAULT_ESCALATION_MARKER)
    max_seconds = int(context.get("maxSeconds", 300))

    # auto_hang_up (on by default) needs Plivo auth creds to call the hangup API;
    # we end calls via the /api/webhooks/plivo/status webhook instead, so disable it.
    serializer = PlivoFrameSerializer(
        stream_id=stream_id,
        call_id=call_id,
        params=PlivoFrameSerializer.InputParams(auto_hang_up=False),
    )

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=serializer,
        ),
    )

    # Saarika auto-detects the spoken language (its InputParams field is `language`,
    # a Language enum, not a code) — leave it to auto-detect for robustness.
    stt = SarvamSTTService(
        api_key=speech["sarvamApiKey"],
        model=STT_MODEL,
    )
    # Humanization: a slightly slower pace + preprocessing (normalizes numbers,
    # dates, mixed English/Hindi/Tamil) makes Bulbul sound more natural.
    tts = SarvamTTSService(
        api_key=speech["sarvamApiKey"],
        voice_id=speech.get("ttsVoice", "anushka"),
        model=TTS_MODEL,
        params=SarvamTTSService.InputParams(
            pace=0.95,
            pitch=0.0,
            enable_preprocessing=True,
        ),
    )
    llm = AnthropicLLMService(api_key=llm_cfg["anthropicApiKey"], model=llm_cfg.get("model", "claude-sonnet-4-6"))

    llm_context = LLMContext([{"role": "system", "content": system_prompt}])
    context_aggregator = LLMContextAggregatorPair(
        llm_context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(audio_in_sample_rate=8000, audio_out_sample_rate=8000),
    )

    started = time.monotonic()
    opening_started = {"done": False}

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        # Make the agent speak first: inject the hidden cue and run the LLM so it
        # produces the opening turn (greeting + intro) itself. Guarded so a
        # transport reconnect can't replay the opening.
        if opening_started["done"]:
            return
        opening_started["done"] = True
        llm_context.add_messages([{"role": "user", "content": CALL_START_CUE}])
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        await task.cancel()

    async def enforce_max_duration():
        try:
            await asyncio.sleep(max_seconds)
            logger.info(f"max call duration reached ({max_seconds}s); ending call {call_id}")
            await task.queue_frame(EndFrame())
        except asyncio.CancelledError:
            pass

    timeout_task = asyncio.create_task(enforce_max_duration())

    runner = PipelineRunner(handle_sigint=False)
    try:
        await runner.run(task)
    finally:
        timeout_task.cancel()
        duration = int(time.monotonic() - started)
        transcript = _extract_transcript(llm_context)
        needs_support = _detect_support(transcript, escalation_marker)
        await post_complete(app_url, token, transcript, duration, default_language, needs_support)
        logger.info(
            f"voice call ended call={call_id} turns={len(transcript)} "
            f"duration={duration}s needs_support={needs_support}"
        )
