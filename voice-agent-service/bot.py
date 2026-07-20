"""Pipecat pipeline for a single voice call.

Pipeline: Plivo audio (8kHz) -> Saarika STT (Sarvam) -> Claude Sonnet -> Bulbul
TTS (Sarvam) -> Plivo audio, with Silero VAD and interruptions. The agent speaks
the direction-specific greeting first, then converses grounded in the system
prompt (which already includes the company knowledge base, injected by the
control plane). On hangup the collected transcript is POSTed back to the CRM.

NOTE ON VERSIONS: the exact import paths / constructor params for Pipecat's
Sarvam and Plivo integrations track the installed `pipecat-ai` version. This file
targets a recent release; if you pin a different version, adjust the imports in
the "Pipecat services" block below. See README.md.
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
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.processors.transcript_processor import TranscriptProcessor
from pipecat.serializers.plivo import PlivoFrameSerializer
from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

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
            vad_analyzer=SileroVADAnalyzer(),
            serializer=serializer,
        ),
    )

    stt = SarvamSTTService(
        api_key=speech["sarvamApiKey"],
        model=STT_MODEL,
        params=SarvamSTTService.InputParams(language_code=default_language),
    )
    tts = SarvamTTSService(
        api_key=speech["sarvamApiKey"],
        voice_id=speech.get("ttsVoice", "anushka"),
        model=TTS_MODEL,
        params=SarvamTTSService.InputParams(target_language_code=default_language),
    )
    llm = AnthropicLLMService(api_key=llm_cfg["anthropicApiKey"], model=llm_cfg.get("model", "claude-sonnet-4-6"))

    messages = [{"role": "system", "content": context.get("systemPrompt", "You are a helpful inquiry agent.")}]
    llm_context = OpenAILLMContext(messages)
    context_aggregator = llm.create_context_aggregator(llm_context)

    transcript_processor = TranscriptProcessor()

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            transcript_processor.user(),
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            transcript_processor.assistant(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000,
        ),
    )

    started = time.monotonic()
    collected: list[dict] = []
    if greeting:
        collected.append({"role": "agent", "text": greeting, "tsMs": 0})

    @transcript_processor.event_handler("on_transcript_update")
    async def on_transcript_update(_processor, frame):
        for message in frame.messages:
            role = "agent" if message.role == "assistant" else "customer"
            text = (message.content or "").strip()
            if not text:
                continue
            collected.append({"role": role, "text": text, "tsMs": int((time.monotonic() - started) * 1000)})

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        # The agent greets first (both inbound and outbound).
        if greeting:
            await task.queue_frames([TTSSpeakFrame(greeting)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        await task.cancel()

    # Hard cap on call length.
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
        await post_complete(app_url, token, collected, duration, default_language)
        logger.info(f"voice call ended call={call_id} turns={len(collected)} duration={duration}s")
