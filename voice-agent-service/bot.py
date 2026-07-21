"""Pipecat pipeline for a single voice call.

Pipeline: Plivo audio (8kHz) -> Saarika STT (Sarvam) -> Claude Sonnet -> Bulbul
TTS (Sarvam) -> Plivo audio, with Silero VAD and interruptions.

Conversation design (turn-based):
  The agent speaks a short, fixed greeting the moment the call connects
  (TTSSpeakFrame -- no LLM round-trip, so it is fast and always exactly the
  configured line), then STOPS and listens. Everything after that is a normal
  turn-based STT -> LLM -> TTS loop: the caller speaks, the agent replies with
  one short turn, then waits again. Pipecat's VAD + smart-turn handle the
  turn-taking; we just avoid opening with a long monologue.

  The full behaviour (the greeting was "already delivered", one short turn at a
  time, the outbound company intro after the caller's first reply, the
  out-of-scope escalation line, and the closing thank-you) is encoded in the
  system prompt built by the control plane at /api/internal/voice/context. The
  knowledge base is embedded in that system prompt once at call start, so it
  stays in the model's memory for every turn (no per-question re-fetch).

  When Claude uses the escalation line ("...connect you with a customer
  executive..."), we detect it in the transcript and report needsSupport=true so
  the dashboard can flag the call for a human follow-up.

Targets the current Pipecat API: universal LLMContext + LLMContextAggregatorPair
and the websocket.fastapi transport. If you pin a very different pipecat-ai
version and hit an ImportError, check the module paths in the imports block.
"""

import asyncio
import os
import time
import traceback

import httpx
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndFrame, TTSSpeakFrame
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

# Default substring used to detect the escalation line in an agent turn. The
# control plane can override it via the context payload so the two stay in sync.
DEFAULT_ESCALATION_MARKER = "customer executive"


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


def _extract_transcript(context, greeting: str | None) -> list:
    """Best-effort transcript from the LLM context after the call ends. The
    greeting is spoken via TTSSpeakFrame and never enters the LLM message
    history, so we prepend it here as the first agent turn."""
    turns = []
    if greeting:
        turns.append({"role": "agent", "text": greeting, "tsMs": 0})

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
    greeting = context.get("greeting")
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

    # The system prompt already embeds the knowledge base and tells the model it
    # has "already greeted" the caller, so the model never re-greets and simply
    # continues the conversation turn by turn.
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
    greeting_spoken = {"done": False}
    end_reason = {"reason": "completed"}

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        # Turn-based opening: speak ONLY the fixed greeting, then wait for the
        # caller. No LLM run here — the agent must not monologue. Guarded so a
        # transport reconnect can't replay the greeting.
        if greeting_spoken["done"]:
            return
        greeting_spoken["done"] = True
        if greeting:
            await task.queue_frames([TTSSpeakFrame(greeting)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        end_reason["reason"] = "client_disconnected"
        logger.info(f"client disconnected; ending call {call_id}")
        await task.cancel()

    async def enforce_max_duration():
        try:
            await asyncio.sleep(max_seconds)
            end_reason["reason"] = "max_duration"
            logger.info(f"max call duration reached ({max_seconds}s); ending call {call_id}")
            await task.queue_frames([EndFrame()])
        except asyncio.CancelledError:
            pass

    timeout_task = asyncio.create_task(enforce_max_duration())

    runner = PipelineRunner(handle_sigint=False)
    try:
        await runner.run(task)
    except Exception as error:  # noqa: BLE001
        end_reason["reason"] = f"error: {type(error).__name__}"
        logger.error(f"pipeline crashed on call {call_id}: {error}\n{traceback.format_exc()}")
    finally:
        timeout_task.cancel()
        duration = int(time.monotonic() - started)
        transcript = _extract_transcript(llm_context, greeting)
        needs_support = _detect_support(transcript, escalation_marker)
        await post_complete(app_url, token, transcript, duration, default_language, needs_support)
        logger.info(
            f"voice call ended call={call_id} reason={end_reason['reason']} "
            f"turns={len(transcript)} duration={duration}s needs_support={needs_support}"
        )
