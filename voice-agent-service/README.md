# Voice Agent worker (LiveKit Agents)

Real-time media plane for the CRM's Voice Agents feature. **LiveKit Cloud** runs
the SIP bridging, audio transport, and turn detection; this worker just joins each
call's room and runs the AI pipeline for one phone call:

```
Plivo number ──SIP──► LiveKit Cloud ──► this worker:
                                         Saarika STT (Sarvam) ─► Claude (Anthropic) ─► Bulbul TTS (Sarvam)
                                         turn-taking handled by LiveKit
```

The Next.js CRM is the control plane: it owns credentials, the database, and the
per-company config. This worker holds **no long-lived tenant secrets** — it
fetches per-call context (keys, greeting, system prompt with the embedded
knowledge base) from the CRM using a short-lived signed token, and posts the
transcript back when the call ends.

## How a call flows

**Outbound** — user clicks *Call* in the dashboard → CRM creates the `VoiceCall`
row → `lib/livekit-voice.ts` dispatches this agent into a room `voice-<callId>`
(metadata carries the token) and dials the customer into that room via the Plivo
**outbound** SIP trunk → the worker fetches `/api/internal/voice/context` with the
token, greets, and converses turn-by-turn → on hangup it POSTs the transcript to
`/api/internal/voice/complete`.

**Inbound** — caller dials the Plivo number → Plivo **origination** routes the
call over SIP to LiveKit → LiveKit's dispatch rule creates a room and dispatches
this agent → the worker reads the dialed/caller numbers from the SIP participant
attributes, calls `/api/internal/voice/inbound-start` (shared-secret auth) to
resolve the tenant + create the row (returns `callId` + token), then follows the
same context → greet → converse → complete path.

## One-time setup

### 1. LiveKit Cloud
Create a project at cloud.livekit.io. From **Settings → Keys** copy the project
URL (`wss://<project>.livekit.cloud`), API key, and API secret. Enable **India
region pinning** for lower latency to Indian callers.

### 2. Plivo SIP trunk (your existing number stays)
Follow the official guide: https://docs.livekit.io/sip/quickstarts/configuring-plivo-trunk/
- **Inbound:** create a Plivo origination URI pointing at your LiveKit SIP host
  (`sip:<project>.sip.livekit.cloud;transport=tcp`), create a Plivo inbound trunk
  with it, and attach your existing phone number.
- **Outbound:** create Plivo termination credentials (username/password), note the
  termination SIP domain (e.g. `xxxx.zt.plivo.com`).

### 3. LiveKit trunks + dispatch rule (via the `lk` CLI or dashboard)
- **Inbound trunk** (accepts calls from Plivo) + a **dispatch rule** that
  dispatches agent `voice-inquiry-agent` and creates a room per call.
- **Outbound trunk** (Plivo termination domain + credentials). Copy its
  `ST_...` id → this is `LIVEKIT_SIP_OUTBOUND_TRUNK_ID`.

### 4. Configure a LiveKit webhook → the CRM
In LiveKit project settings, add a webhook pointing at
`https://<crm-host>/api/webhooks/livekit` (it verifies the LiveKit signature).

### 5. Secrets
On the **CRM** app: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`LIVEKIT_SIP_OUTBOUND_TRUNK_ID`, and (already set) `VOICE_SERVICE_SECRET`.
On the **worker**: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`APP_URL` (the CRM), `VOICE_SERVICE_SECRET` (same value as the CRM). Per-tenant
Sarvam/Claude keys are **not** set here — they come from `/context` per call.

## Run locally

```bash
cd voice-agent-service
cp .env.example .env          # fill LIVEKIT_* + APP_URL + VOICE_SERVICE_SECRET
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python agent.py download-files   # cache the Silero VAD model
python agent.py dev              # connect to LiveKit Cloud and wait for calls
```

The worker dials **out** to LiveKit Cloud, so there is no port to expose. Place a
test call from the CRM dashboard; the agent joins the room and greets.

## Deploy (Fly)

```bash
cd voice-agent-service
fly deploy                       # app finalcrm-os-voice (see fly.toml)
```

No `[http_service]` — it is a worker, not a server. Keep one machine running so it
stays registered with LiveKit Cloud and ready to take calls.

## Environment

| Var | Purpose |
| --- | --- |
| `LIVEKIT_URL` | LiveKit Cloud project URL (`wss://…`). The worker dials out to it. |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit project credentials. |
| `APP_URL` | Base URL of the CRM control plane. |
| `VOICE_SERVICE_SECRET` | Shared secret for `inbound-start` auth (must match the CRM). |
| `VOICE_AGENT_NAME` | Agent name; must match the CRM dispatch + LiveKit inbound rule (default `voice-inquiry-agent`). |
| `SARVAM_STT_MODEL` / `SARVAM_TTS_MODEL` | Optional model overrides (default `saarika:v2.5` / `bulbul:v2`). |

## Version note

`agent.py` was written and verified against **livekit-agents 1.6.x** and the
matching `livekit-plugins-sarvam` / `-anthropic` / `-silero`. If you bump the pin
in `requirements.txt`, re-check the `AgentSession` / `session.say` / `session.start`
signatures and the `sarvam.STT` / `sarvam.TTS` / `anthropic.LLM` constructors —
they occasionally change between minor versions.
