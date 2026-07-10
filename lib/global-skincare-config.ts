import { googleSheetTabRange } from "@/lib/google-sheets-leads";

/**
 * Company-specific configuration for Global Skin Care.
 *
 * For this tenant only, call transcripts + phone numbers are stored in a Google
 * Sheet tab. The AI reads each transcript, extracts the scheduled appointment,
 * and sends an appointment follow-up WhatsApp template. Everything here is gated
 * behind {@link isGlobalSkincareTenant} so no other tenant is affected.
 */

export const GLOBAL_SKINCARE_APPOINTMENT_ADAPTER = "global-skincare-appointment";
export const GLOBAL_SKINCARE_APPOINTMENT_TEMPLATE_ROLE = "APPOINTMENT_FOLLOWUP" as const;

const DEFAULT_TRANSCRIPT_TAB = "call_transcripts";
const DEFAULT_SEND_GAP_MS = 6000;
const DEFAULT_MAX_PER_RUN = 50;
const DEFAULT_MAX_FAILURES = 2;

// Slug/name variants collapse to a single canonical key so "Global Skin Care",
// "global-skin-care", and "globalskincare" all match.
function normalizeKey(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function configuredTenantKeys() {
  const keys = new Set<string>(["globalskincare"]);
  for (const raw of [process.env.GLOBAL_SKINCARE_TENANT_SLUG, process.env.GLOBAL_SKINCARE_TENANT_NAME]) {
    for (const part of (raw ?? "").split(",")) {
      const key = normalizeKey(part);
      if (key) keys.add(key);
    }
  }
  return keys;
}

export function isGlobalSkincareTenant(tenant: { slug?: string | null; name?: string | null }) {
  const keys = configuredTenantKeys();
  return keys.has(normalizeKey(tenant.slug)) || keys.has(normalizeKey(tenant.name));
}

export function globalSkincareTranscriptTab() {
  return process.env.GLOBAL_SKINCARE_TRANSCRIPT_TAB?.trim() || DEFAULT_TRANSCRIPT_TAB;
}

export function globalSkincareTranscriptRange() {
  return googleSheetTabRange(globalSkincareTranscriptTab());
}

function positiveNumberEnv(name: string, fallback: number, { min, max }: { min: number; max: number }) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.max(value, min), max);
}

export function globalSkincareReminderLeadMs(): number | null {
  // How long before the appointment the follow-up becomes due.
  //   unset (default) -> null -> send immediately once the appointment is known.
  //   set to N hours  -> only send when the appointment is within N hours (a
  //                      pre-appointment reminder).
  const raw = process.env.GLOBAL_SKINCARE_APPOINTMENT_REMINDER_LEAD_HOURS;
  if (raw === undefined || raw.trim() === "") return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return null;
  return Math.min(hours, 24 * 30) * 60 * 60 * 1000;
}

export function globalSkincareSendGapMs() {
  return positiveNumberEnv("GLOBAL_SKINCARE_APPOINTMENT_SEND_GAP_MS", DEFAULT_SEND_GAP_MS, { min: 0, max: 60_000 });
}

export function globalSkincareMaxPerRun() {
  return Math.round(
    positiveNumberEnv("GLOBAL_SKINCARE_APPOINTMENT_MAX_PER_RUN", DEFAULT_MAX_PER_RUN, { min: 1, max: 200 })
  );
}

export function globalSkincareMaxFailures() {
  return Math.round(
    positiveNumberEnv("GLOBAL_SKINCARE_APPOINTMENT_MAX_FAILURES", DEFAULT_MAX_FAILURES, { min: 1, max: 10 })
  );
}

export type GlobalSkincareAppointmentState = {
  appointmentAt?: string | null; // ISO-8601 when a specific date/time was extracted
  appointmentText?: string | null; // human phrase, e.g. "Tuesday 3:00 PM"
  hasAppointment?: boolean;
  transcriptHash?: string; // detects transcript edits so we can re-extract
  extractedAt?: string;
  remindedAt?: string;
  sourceTab?: string;
  sourceRow?: number;
  status?: "reminded" | "no_appointment" | "failed";
  failures?: number;
  lastFailureReason?: string;
  lastSkipReason?: string;
  lastSkippedAt?: string;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readGlobalSkincareAppointmentState(customFields: unknown): GlobalSkincareAppointmentState {
  return asRecord(asRecord(customFields).globalSkincareAppointment) as GlobalSkincareAppointmentState;
}

export function withGlobalSkincareAppointmentState(customFields: unknown, state: GlobalSkincareAppointmentState) {
  return {
    ...asRecord(customFields),
    globalSkincareAppointment: state
  };
}
