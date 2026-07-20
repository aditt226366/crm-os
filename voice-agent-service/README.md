# Voice Agent media service (Pipecat)

Standalone, always-on media plane for the CRM's Voice Agents feature. It runs the
real-time audio loop for one phone call:

```
Plivo audio (8kHz, wss) ─► Saarika STT (Sarvam) ─► Claude Sonnet 4.6 ─► Bulbul TTS (Sarvam) ─► Plivo audio
                            with Silero VAD + interruptions
```

The Next.js CRM app is the control plane: it owns credentials, the database, and
all Plivo REST calls, and it hands this service everything it needs per call via
a short-lived signed token. This service holds **no long-lived secrets** — it
only relays that token back to the control plane as a bearer credential.

## How a call flows

1. Plivo answers a call and hits the CRM's `/api/webhooks/plivo/answer`, which
   returns Plivo XML opening a bidirectional audio stream to `wss://<this>/ws?token=<jwt>`.
2. `server.py` accepts the websocket, reads `?token=`, and calls the CRM's
   `GET /api/internal/voice/context` (bearer = token) to fetch the Sarvam +
   Anthropic keys, the greeting, the composed system prompt (already including
   the company knowledge base), and call metadata.
3. It reads Plivo's stream `start` frames (streamId / callId) and runs the
   Pipecat pipeline in `bot.py`. The agent greets first, then converses.
4. On hangup it POSTs the transcript to `POST /api/internal/voice/complete`
   (bearer = token). The CRM saves it and generates a summary.

## Run locally

```bash
cd voice-agent-service
cp .env.example .env          # set APP_URL to your running CRM (or its tunnel)
python -m venv .venv && source .venv/bin/activate   # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
python server.py              # listens on :8080
```

Expose it publicly so Plivo can reach it (e.g. `ngrok http 8080`) and set
`VOICE_SERVICE_WS_URL` in the CRM's env to the resulting `wss://…` host. Point
your Plivo Application's Answer URL at `https://<crm-host>/api/webhooks/plivo/answer`
and its Hangup URL at `https://<crm-host>/api/webhooks/plivo/status`.

## Deploy

Build the container and run it as a second always-on service next to the CRM:

```bash
docker build -t voice-agent-service .
docker run -p 8080:8080 --env APP_URL=https://<crm-host> voice-agent-service
```

It must be reachable over `wss://` (Plivo requires TLS for streaming in
production). Set `VOICE_SERVICE_WS_URL=wss://<this-host>` in the CRM.

## Environment

| Var | Purpose |
| --- | --- |
| `APP_URL` | Base URL of the CRM control plane. |
| `PORT` | Listen port (default 8080). |
| `SARVAM_STT_MODEL` / `SARVAM_TTS_MODEL` | Optional model overrides. |

## Version note

`bot.py` targets a recent `pipecat-ai` release. The Sarvam (`SarvamSTTService`,
`SarvamTTSService`) and Plivo (`PlivoFrameSerializer`) integrations occasionally
change import paths or constructor params between versions. If you pin a
different version and see an ImportError or TypeError at startup, adjust the
imports/params in the "Pipecat services" block of `bot.py` to match your
installed version. If a build lacks a Sarvam service, implement a thin
`STTService` / `TTSService` subclass against Sarvam's streaming Saarika/Bulbul
APIs and swap it in.

## Latency

Target is ~400 ms voice-to-voice. It is reached only with full streaming at every
stage plus regional colocation (Plivo India + Sarvam India + this service in the
same region). Realistic cloud STT→LLM→TTS is ~400–800 ms — treat 400 ms as a
tuning target, not a guarantee.
