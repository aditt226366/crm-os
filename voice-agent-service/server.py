"""FastAPI entrypoint for the Voice Agent media service.

This is the standalone, always-on media plane referenced by the CRM control
plane. Plivo opens a bidirectional audio websocket to /ws (see the Plivo answer
XML built in the Next.js app at lib/plivo-voice.ts). On connect we:

  1. read the short-lived call token from the ?token= query param,
  2. fetch the call context (credentials, greeting, system prompt, KB) from the
     control plane's /api/internal/voice/context,
  3. read Plivo's stream "start" frames to learn the stream/call ids,
  4. run the Pipecat pipeline (Saarika STT -> Claude -> Bulbul TTS),
  5. on hangup, POST the transcript to /api/internal/voice/complete.

The token is opaque to this service — it is only relayed as a bearer credential
back to the control plane, which signs and verifies it. This service therefore
holds no long-lived secrets of its own.
"""

import json
import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from loguru import logger

from bot import run_bot

load_dotenv()

APP_URL = os.getenv("APP_URL", "http://127.0.0.1:3000").rstrip("/")

app = FastAPI()


@app.get("/health")
async def health():
    return {"ok": True}


async def fetch_context(token: str) -> dict | None:
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            response = await client.get(
                f"{APP_URL}/api/internal/voice/context",
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as error:
            logger.error(f"context fetch failed: {error}")
            return None
    if response.status_code != 200:
        logger.error(f"context fetch rejected: {response.status_code} {response.text[:200]}")
        return None
    return response.json()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    token = websocket.query_params.get("token")
    if not token:
        logger.warning("ws connection without token")
        await websocket.close(code=4401)
        return

    context = await fetch_context(token)
    if not context:
        await websocket.close(code=4403)
        return

    # Plivo streams JSON text frames. Unlike Twilio, `streamId` is at the TOP
    # LEVEL of each frame (not nested under a "start" object), and there is no
    # leading "connected" frame to skip. `callId` appears in the "start" event.
    # Scan the first few frames until we have the streamId (usually frame #1).
    stream_id = None
    call_id = None
    try:
        messages = websocket.iter_text()
        for _ in range(20):
            raw = await messages.__anext__()
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue
            start_obj = data.get("start") if isinstance(data.get("start"), dict) else {}
            stream_id = stream_id or data.get("streamId") or data.get("stream_id") or start_obj.get("streamId")
            call_id = call_id or start_obj.get("callId") or data.get("callId")
            if stream_id:
                break
    except StopAsyncIteration:
        pass

    if not stream_id:
        logger.error("no streamId found in Plivo frames")
        await websocket.close(code=4400)
        return

    logger.info(f"voice call connected stream={stream_id} call={call_id}")
    await run_bot(
        websocket=websocket,
        token=token,
        app_url=APP_URL,
        stream_id=stream_id,
        call_id=call_id,
        context=context,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
