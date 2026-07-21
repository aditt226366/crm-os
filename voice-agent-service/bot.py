"""Pipecat pipeline for a single voice call.

Pipeline: Plivo audio (8kHz) -> Saarika STT (Sarvam) -> Claude Sonnet -> Bulbul
TTS (Sarvam) -> Plivo audio, with Silero VAD and interruptions. The agent speaks
the direction-specific greeting first, then converses grounded in the system
prompt (which already includes the company knowledge base). On hangup the
collected transcript is POSTed back to the CRM.

Targets the current Pipecat API: universal LLMContext (pipecat.processors.
aggregators.llm_context) + LLMContextAggregatorPair, and the websocket.fastapi
transport. If you pin a very different pipecat-ai version and hit an ImportError,
check the module paths in the imports block against your installed version.
"""

import asyncio
import os
import time

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


async def post_complete(app_url: str, token: str, transcript: list, duration_sec: int, language: str, status: str = "COMPLETED"):
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


def _extract_transcript(context, greeting) -> list:
    """Best-effort transcript from the LLM context after the call ends."""
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
        if text:
            turns.append({"role": "agent" if role == "assistant" else "customer", "text": text})
    return turns


async def run_bot(websocket, token: str, app_url: str, stream_id: str, call_id: str | None, context: dict):
    speech = context.get("speech", {})
    llm_cfg = context.get("llm", {})
    default_language = speech.get("defaultLanguage", "en-IN")
    greeting = context.get("greeting")
    max_seconds = int(context.get("maxSeconds", 300))

    serializer = PlivoFrameSerializer(stream_id=stream_id, call_id=call_id)

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

    llm_context = LLMContext(
        [{"role": "system", "content": context.get("systemPrompt", "You are a helpful inquiry agent.")}]
    )
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

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        # The agent greets first (both inbound and outbound).
        if greeting:
            await task.queue_frames([TTSSpeakFrame(greeting)])

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
        transcript = _extract_transcript(llm_context, greeting)
        await post_complete(app_url, token, transcript, duration, default_language)
        logger.info(f"voice call ended call={call_id} turns={len(transcript)} duration={duration}s")
