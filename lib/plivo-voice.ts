import { ApiError } from "@/lib/api";
import type { IntegrationConfig } from "@/lib/integration-vault";

// Plivo voice client. Mirrors lib/whatsapp-cloud.ts: raw fetch + per-tenant
// encrypted config, no SDK. All Plivo REST calls live in the control plane so
// Plivo credentials never reach the media (Pipecat) service.

const PLIVO_API_BASE = "https://api.plivo.com/v1/Account";

function plivoAuth(config: IntegrationConfig) {
  const authId = config.PLIVO_AUTH_ID?.trim();
  const authToken = config.PLIVO_AUTH_TOKEN?.trim();
  if (!authId || !authToken) {
    throw new ApiError(409, "VOICE_AGENT_CONFIG_MISSING", "Plivo is not configured for this company.");
  }
  return {
    authId,
    header: `Basic ${Buffer.from(`${authId}:${authToken}`).toString("base64")}`
  };
}

async function plivoPost(config: IntegrationConfig, path: string, body: Record<string, unknown>) {
  const { authId, header } = plivoAuth(config);
  let response: Response;
  try {
    response = await fetch(`${PLIVO_API_BASE}/${encodeURIComponent(authId)}/${path}`, {
      method: "POST",
      headers: {
        Authorization: header,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    return { ok: false, status: 0, data: null as unknown, error: error instanceof Error ? error.message : "Plivo request failed." };
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const message =
    data && typeof data === "object" ? ((data as { error?: string; message?: string }).error ?? (data as { message?: string }).message) : undefined;
  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok ? undefined : message || text || "Plivo request failed."
  };
}

export function normalizePlivoNumber(value: string) {
  const trimmed = value.trim().replace(/[\s-]/g, "");
  return trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/^\+/, "")}`;
}

export async function makeOutboundCall({
  config,
  to,
  answerUrl,
  hangupUrl
}: {
  config: IntegrationConfig;
  to: string;
  answerUrl: string;
  hangupUrl?: string;
}) {
  const from = config.PLIVO_PHONE_NUMBER?.trim();
  if (!from) {
    throw new ApiError(409, "VOICE_AGENT_CONFIG_MISSING", "Plivo virtual number is not configured for this company.");
  }
  const result = await plivoPost(config, "Call/", {
    from: normalizePlivoNumber(from),
    to: normalizePlivoNumber(to),
    answer_url: answerUrl,
    answer_method: "POST",
    ...(hangupUrl ? { hangup_url: hangupUrl, hangup_method: "POST" } : {})
  });
  // Plivo returns request_uuid on Make Call; the real CallUUID arrives on the
  // answer/status callbacks.
  const requestUuid =
    result.data && typeof result.data === "object" ? (result.data as { request_uuid?: string }).request_uuid : undefined;
  return { ...result, requestUuid };
}

export async function startRecording({
  config,
  callUuid,
  callbackUrl
}: {
  config: IntegrationConfig;
  callUuid: string;
  callbackUrl: string;
}) {
  return plivoPost(config, `Call/${encodeURIComponent(callUuid)}/Record/`, {
    file_format: "mp3",
    callback_url: callbackUrl,
    callback_method: "POST"
  });
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plivo answer XML: opens a bidirectional 8kHz L16 audio stream to the Pipecat
// media service websocket. Pipecat's PlivoFrameSerializer speaks the same format.
export function buildStreamAnswerXml({ wssUrl }: { wssUrl: string }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${xmlEscape(wssUrl)}</Stream>`,
    "</Response>"
  ].join("\n");
}

export function buildHangupXml(reason?: string) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    reason ? `  <!-- ${xmlEscape(reason)} -->` : "",
    "  <Hangup/>",
    "</Response>"
  ]
    .filter(Boolean)
    .join("\n");
}
