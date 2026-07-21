"""Local smoke test — construct every Pipecat object run_bot() builds, with dummy
keys, to catch import/param/wiring errors WITHOUT a real Plivo call. Runs inside
an asyncio event loop (like the real websocket handler) so loop-bound objects such
as PipelineRunner construct exactly as they do in production. Exits non-zero on the
first failure so `docker run` surfaces it clearly."""

import asyncio
import sys


def ok(msg):
    print(f"[OK] {msg}", flush=True)


async def main():
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
    from pipecat.services.anthropic.llm import AnthropicLLMService
    from pipecat.services.sarvam.stt import SarvamSTTService
    from pipecat.services.sarvam.tts import SarvamTTSService

    ok("all imports")

    # Also import our own module (catches syntax/logic errors in bot.py/server.py)
    import bot  # noqa: F401
    import server  # noqa: F401

    ok("bot.py + server.py import")

    serializer = PlivoFrameSerializer(
        stream_id="s1", call_id="c1", params=PlivoFrameSerializer.InputParams(auto_hang_up=False)
    )
    ok("PlivoFrameSerializer(stream_id, call_id, auto_hang_up=False)")

    stt = SarvamSTTService(api_key="dummy", model="saarika:v2.5")
    ok("SarvamSTTService")

    tts = SarvamTTSService(
        api_key="dummy",
        voice_id="anushka",
        model="bulbul:v2",
        params=SarvamTTSService.InputParams(pace=0.95, pitch=0.0, enable_preprocessing=True),
    )
    ok("SarvamTTSService + InputParams(pace,pitch,enable_preprocessing)")

    llm = AnthropicLLMService(api_key="dummy", model="claude-sonnet-4-6")
    ok("AnthropicLLMService")

    ctx = LLMContext([{"role": "system", "content": "test"}])
    ok("LLMContext([system])")

    agg = LLMContextAggregatorPair(
        ctx, user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer())
    )
    ok("LLMContextAggregatorPair + LLMUserAggregatorParams(vad_analyzer) + SileroVADAnalyzer()")

    # Full pipeline wiring — the exact processor order run_bot() uses. This catches
    # any incompatibility between the serializer/STT/LLM/TTS/aggregator objects.
    pipeline = Pipeline(
        [stt, agg.user(), llm, tts, agg.assistant()]
    )
    ok("Pipeline([stt, user, llm, tts, assistant])")

    task = PipelineTask(
        pipeline,
        params=PipelineParams(audio_in_sample_rate=8000, audio_out_sample_rate=8000),
    )
    ok("PipelineTask + PipelineParams(8000/8000)")

    PipelineRunner(handle_sigint=False)
    ok("PipelineRunner(handle_sigint=False)")

    TTSSpeakFrame("hi")
    EndFrame()
    ok("TTSSpeakFrame / EndFrame")


try:
    asyncio.run(main())
    print("\nSMOKE TEST PASSED — every object run_bot() builds constructs cleanly.", flush=True)
except Exception:  # noqa: BLE001
    import traceback

    print("\nSMOKE TEST FAILED:", flush=True)
    traceback.print_exc()
    sys.exit(1)
