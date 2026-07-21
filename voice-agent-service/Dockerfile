FROM python:3.12-slim

WORKDIR /app

# build-essential is needed to build some native deps (onnxruntime for Silero VAD).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Pre-download plugin model files (Silero VAD) so call cold-starts are fast.
RUN python agent.py download-files

# LiveKit Agents worker. It dials OUT to LiveKit Cloud (LIVEKIT_URL) to receive
# jobs, so there is no public port/websocket to expose — LiveKit Cloud handles
# all SIP + real-time media. Needs LIVEKIT_URL / LIVEKIT_API_KEY /
# LIVEKIT_API_SECRET, plus APP_URL + VOICE_SERVICE_SECRET to reach the CRM.
CMD ["python", "agent.py", "start"]
