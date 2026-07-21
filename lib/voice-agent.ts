import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import type { VoiceCallStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";

// Shared helpers for the Voice Agent feature (Plivo + Pipecat media service).
// The control plane (this app) owns credentials, DB, and all Plivo REST; the
// media service is a stateless media worker that authenticates with a short-lived
// signed call token carried in the Plivo answer <Stream> URL.

const serviceSecret = new TextEncoder().encode(
  process.env.VOICE_SERVICE_SECRET ?? "local-voice-service-secret-change-before-production-32"
);

export type CallTokenPayload = {
  callId: string;
  tenantId: string;
};

export function voiceServiceWsUrl() {
  return (process.env.VOICE_SERVICE_WS_URL ?? "ws://127.0.0.1:8080").replace(/\/$/, "");
}

export function appBaseUrl(origin?: string) {
  // Prefer the configured public URL. Behind a proxy (Fly/Render/etc.) the
  // request origin is often the internal address (http://localhost:3000), which
  // Plivo cannot reach — so the answer/hangup callback URLs must come from
  // APP_URL, falling back to the request origin only when APP_URL is unset.
  return (process.env.APP_URL?.trim() || origin || "http://127.0.0.1:3000").replace(/\/$/, "");
}

export async function signCallToken(payload: CallTokenPayload) {
  return new SignJWT({ callId: payload.callId, tenantId: payload.tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(serviceSecret);
}

export async function verifyCallToken(token: string): Promise<CallTokenPayload> {
  const { payload } = await jwtVerify(token, serviceSecret);
  const callId = typeof payload.callId === "string" ? payload.callId : "";
  const tenantId = typeof payload.tenantId === "string" ? payload.tenantId : "";
  if (!callId || !tenantId) {
    throw new Error("Invalid call token payload");
  }
  return { callId, tenantId };
}

// Extract the media-service token from either the Authorization: Bearer header
// or a ?token= query param.
export function callTokenFromRequest(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return request.nextUrl.searchParams.get("token")?.trim() ?? null;
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

// Two phone numbers match if their trailing 10 digits are equal (India / most
// numbering plans), which tolerates +/country-code/formatting differences.
export function phoneNumbersMatch(a: string, b: string) {
  const left = digitsOnly(a);
  const right = digitsOnly(b);
  if (!left || !right) return false;
  return left.slice(-10) === right.slice(-10);
}

export async function loadVoiceAgentConfig(tenantId: string) {
  const integration = await prisma.integration.findUnique({
    where: { tenantId_type: { tenantId, type: "VOICE_AGENT" } },
    select: { status: true, encryptedConfig: true }
  });
  if (!integration) return null;
  return {
    status: integration.status,
    config: readEncryptedConfig(integration.encryptedConfig)
  };
}

// Resolve which connected tenant owns a dialed (inbound) Plivo number.
export async function resolveVoiceTenantByNumber(dialedNumber: string) {
  const integrations = await prisma.integration.findMany({
    where: { type: "VOICE_AGENT", status: "CONNECTED" },
    select: { tenantId: true, encryptedConfig: true },
    take: 200
  });
  const match = integrations.find((integration) =>
    phoneNumbersMatch(readEncryptedConfig(integration.encryptedConfig).PLIVO_PHONE_NUMBER ?? "", dialedNumber)
  );
  return match?.tenantId ?? null;
}

export function renderCompanyText(text: string, companyName: string) {
  return text.replace(/\{\{\s*company\s*\}\}/gi, companyName);
}

export function resolveGreeting(config: IntegrationConfig, direction: "INBOUND" | "OUTBOUND") {
  const company = config.COMPANY_DISPLAY_NAME?.trim() || "our company";
  const outboundDefault = "Hi, I'm the inquiry assistant from {{company}}. Do you have two minutes to talk?";
  const inboundDefault = "Hello, welcome to {{company}}. How may I help you?";
  const template =
    direction === "OUTBOUND"
      ? config.OUTBOUND_GREETING?.trim() || outboundDefault
      : config.INBOUND_GREETING?.trim() || inboundDefault;
  return renderCompanyText(template, company);
}

export function maxCallSeconds(config: IntegrationConfig) {
  const parsed = Number.parseInt(config.MAX_CALL_SECONDS ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300;
  return Math.min(parsed, 3600);
}

// Plivo posts application/x-www-form-urlencoded with CamelCase keys.
export async function readPlivoForm(request: NextRequest): Promise<Record<string, string>> {
  try {
    const form = await request.formData();
    const out: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      out[key] = typeof value === "string" ? value : "";
    }
    return out;
  } catch {
    return {};
  }
}

export function mapPlivoCallStatus(value: string): VoiceCallStatus | null {
  switch (value.trim().toLowerCase()) {
    case "ringing":
      return "RINGING";
    case "in-progress":
      return "IN_PROGRESS";
    case "completed":
      return "COMPLETED";
    case "busy":
      return "BUSY";
    case "no-answer":
    case "timeout":
      return "NO_ANSWER";
    case "failed":
      return "FAILED";
    case "cancel":
    case "canceled":
      return "CANCELED";
    default:
      return null;
  }
}

export const VOICE_TERMINAL_STATUSES: VoiceCallStatus[] = ["COMPLETED", "FAILED", "NO_ANSWER", "BUSY", "CANCELED"];

export const VOICE_LANGUAGES = ["English", "Hindi", "Tamil"] as const;

type SerializableVoiceCall = {
  id: string;
  direction: string;
  status: string;
  fromNumber: string;
  toNumber: string;
  language: string | null;
  durationSec: number | null;
  recordingUrl: string | null;
  summary: string | null;
  errorMessage?: string | null;
  transcript?: unknown;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  contact?: { name: string | null } | null;
};

export function serializeVoiceCall(call: SerializableVoiceCall, options?: { includeTranscript?: boolean }) {
  return {
    id: call.id,
    direction: call.direction,
    status: call.status,
    fromNumber: call.fromNumber,
    toNumber: call.toNumber,
    contactName: call.contact?.name ?? null,
    language: call.language,
    durationSec: call.durationSec,
    hasRecording: Boolean(call.recordingUrl),
    recordingUrl: call.recordingUrl ?? null,
    summary: call.summary,
    errorMessage: call.errorMessage ?? null,
    ...(options?.includeTranscript
      ? { transcript: Array.isArray(call.transcript) ? call.transcript : [] }
      : {}),
    createdAt: call.createdAt.toISOString(),
    startedAt: call.startedAt ? call.startedAt.toISOString() : null,
    endedAt: call.endedAt ? call.endedAt.toISOString() : null
  };
}
