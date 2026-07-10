import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateAiCompletion } from "@/lib/ai-agent";
import { resolveContactForPhone } from "@/lib/contact-identity";
import { createOutboundConversationMessage, serializeConversation, serializeMessage } from "@/lib/inbox";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { readEncryptedConfig, type IntegrationConfig } from "@/lib/integration-vault";
import {
  ensureGoogleSheetStatusColumn,
  readGoogleSheetTable,
  updateGoogleSheetLeadStatuses
} from "@/lib/google-sheets-leads";
import { emitTenantEvent } from "@/lib/realtime";
import { recordUsage } from "@/lib/usage";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/phone/normalizePhone";
import {
  createMetaDeliveryLimit,
  isMetaDeliveryLimitError,
  metaDeliveryLimitReason,
  withContactMetaDeliveryLimit,
  withMetaDeliveryLimitMetadata
} from "@/lib/meta-delivery-limit";
import {
  loadTenantTemplateMessageConfig,
  sendTemplateMessage,
  TEMPLATE_SETTINGS_NOT_CONFIGURED_MESSAGE,
  type TenantTemplateMessageConfig
} from "@/lib/tenant-template-messaging";
import { type WhatsAppTemplateLead } from "@/lib/whatsapp-cloud";
import {
  GLOBAL_SKINCARE_APPOINTMENT_ADAPTER,
  GLOBAL_SKINCARE_APPOINTMENT_TEMPLATE_ROLE,
  globalSkincareMaxFailures,
  globalSkincareMaxPerRun,
  globalSkincareReminderLeadMs,
  globalSkincareSendGapMs,
  globalSkincareTranscriptRange,
  globalSkincareTranscriptTab,
  readGlobalSkincareAppointmentState,
  withGlobalSkincareAppointmentState,
  type GlobalSkincareAppointmentState
} from "@/lib/global-skincare-config";

export type GlobalSkincareAppointmentResult = {
  phone: string;
  status: "sent" | "failed" | "skipped" | "no_appointment";
  reason?: string;
  conversationId?: string;
  messageId?: string;
  whatsappMessageId?: string | null;
  appointmentText?: string | null;
  appointmentAt?: string | null;
  rowNumber?: number;
};

export type GlobalSkincareAppointmentRunResult = {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  noAppointment: number;
  templateMissing: boolean;
  reason?: string;
  results: GlobalSkincareAppointmentResult[];
};

type ExtractedAppointment = {
  hasAppointment: boolean;
  appointmentIso: string | null;
  appointmentText: string | null;
};

const TRANSCRIPT_CHAR_LIMIT = 6000;

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function emptyResult(reason: string, templateMissing = false): GlobalSkincareAppointmentRunResult {
  return { scanned: 0, sent: 0, failed: 0, skipped: 0, noAppointment: 0, templateMissing, reason, results: [] };
}

function findColumn(headers: string[], patterns: RegExp[]) {
  const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header.trim().toLowerCase())));
  return index >= 0 ? index : null;
}

function cellAt(cells: string[], index: number | null) {
  return index === null ? "" : String(cells[index] ?? "").trim();
}

function pickPhone(cells: string[], phoneIndex: number | null) {
  const primary = normalizePhone(cellAt(cells, phoneIndex));
  if (isValidNormalizedPhone(primary)) return primary;
  for (const value of cells) {
    const candidate = normalizePhone(String(value ?? ""));
    if (isValidNormalizedPhone(candidate)) return candidate;
  }
  return null;
}

function transcriptHash(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function parseAppointmentDate(iso: string | null): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function appointmentExtractionSystemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "You extract appointment details from a call transcript for a skincare clinic.",
    `Today's date is ${today}.`,
    "Return ONLY a compact JSON object, no prose and no code fences, with exactly these keys:",
    '{"hasAppointment": boolean, "appointmentIso": string|null, "appointmentText": string|null, "confidence": number}',
    "- hasAppointment: true only if the customer has an appointment, booking, or clinic visit scheduled.",
    '- appointmentIso: the appointment in ISO-8601 local format "YYYY-MM-DDTHH:mm" when a concrete date/time is known, else null. Resolve relative dates like "tomorrow" or "next Tuesday" using today\'s date.',
    '- appointmentText: a short human phrase, e.g. "Tuesday, 15 July at 3:30 PM"; null if none.',
    "- confidence: a number from 0 to 1."
  ].join("\n");
}

async function extractAppointmentFromTranscript(
  aiConfig: IntegrationConfig,
  transcript: string
): Promise<ExtractedAppointment | null> {
  const completion = await generateAiCompletion({
    config: aiConfig,
    system: appointmentExtractionSystemPrompt(),
    user: transcript.slice(0, TRANSCRIPT_CHAR_LIMIT),
    maxTokens: 200
  });
  if (!completion?.text) return null;

  const parsed = safeJsonObject(completion.text);
  if (!parsed) return null;

  const appointmentIso = typeof parsed.appointmentIso === "string" ? parsed.appointmentIso.trim() || null : null;
  const appointmentText = typeof parsed.appointmentText === "string" ? parsed.appointmentText.trim() || null : null;
  const hasAppointment = parsed.hasAppointment === true && Boolean(appointmentIso || appointmentText);

  return { hasAppointment, appointmentIso, appointmentText };
}

async function upsertTranscriptConversation({
  tenantId,
  phone,
  name
}: {
  tenantId: string;
  phone: string;
  name: string | null;
}) {
  const resolved = await resolveContactForPhone({
    tenantId,
    phone,
    name,
    source: "GOOGLE_SHEET",
    tags: ["global-skincare", "call-transcript"]
  });
  const contact = await prisma.contact.update({
    where: { id: resolved.contact.id },
    data: { lastMessageAt: new Date() }
  });

  const conversation =
    (await prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id, status: { not: "RESOLVED" } },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }]
    })) ??
    (await prisma.conversation.create({
      data: {
        tenantId,
        contactId: contact.id,
        source: "GOOGLE_SHEET",
        status: "OPEN"
      }
    }));

  return { contact, conversation };
}

async function alreadyRemindedInDb(tenantId: string, conversationId: string) {
  const existing = await prisma.message.findFirst({
    where: {
      tenantId,
      conversationId,
      direction: "OUTBOUND",
      type: "TEMPLATE",
      status: { in: ["PENDING", "SENT", "DELIVERED", "READ"] },
      metadata: { path: ["adapter"], equals: GLOBAL_SKINCARE_APPOINTMENT_ADAPTER }
    },
    select: { id: true }
  });
  return Boolean(existing);
}

async function safeUsage(input: {
  tenantId: string;
  provider: string;
  eventType: string;
  status: string;
  cost: number;
  metadata?: unknown;
}) {
  try {
    await recordUsage({
      tenantId: input.tenantId,
      feature: "AI_AGENTS",
      provider: input.provider,
      eventType: input.eventType,
      endpoint: "/api/cron/leads/sheets",
      units: 1,
      cost: input.cost,
      status: input.status,
      metadata: input.metadata
    });
  } catch (error) {
    console.error("[global-skincare-appointments.usage] failed", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Company-specific (Global Skin Care) flow. Reads call transcripts + phone
 * numbers from the configured Google Sheet tab, uses the tenant's AI model to
 * extract the scheduled appointment, and sends the appointment follow-up
 * WhatsApp template. The CRM DB is the source of truth for de-duplication; the
 * sheet status column is written back for operator visibility only.
 */
export async function runGlobalSkincareAppointmentFollowUps({
  tenantId,
  userId,
  maxRows = globalSkincareMaxPerRun()
}: {
  tenantId: string;
  userId: string;
  maxRows?: number;
}): Promise<GlobalSkincareAppointmentRunResult> {
  await ensureIntegrationSchema();
  await ensureLeadWorkspaceSchema();

  // Appointment follow-up template (WHATSAPP_TEMPLATE_SETTINGS + WHATSAPP_CLOUD).
  let templateMessageConfig: TenantTemplateMessageConfig;
  try {
    templateMessageConfig = await loadTenantTemplateMessageConfig({
      tenantId,
      templatePurpose: GLOBAL_SKINCARE_APPOINTMENT_TEMPLATE_ROLE
    });
  } catch (error) {
    return emptyResult(
      error instanceof Error ? error.message : TEMPLATE_SETTINGS_NOT_CONFIGURED_MESSAGE,
      true
    );
  }

  const [sheetsIntegration, aiIntegration] = await Promise.all([
    prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: "GOOGLE_SHEETS" } },
      select: { status: true, encryptedConfig: true, lastVerificationError: true }
    }),
    prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: "AI_MODEL" } },
      select: { status: true, encryptedConfig: true, lastVerificationError: true }
    })
  ]);

  if (sheetsIntegration?.status !== "CONNECTED") {
    return emptyResult(sheetsIntegration?.lastVerificationError || "Google Sheets is not connected for this company.");
  }
  if (aiIntegration?.status !== "CONNECTED") {
    return emptyResult(aiIntegration?.lastVerificationError || "AI model is not connected for this company.");
  }

  const sheetsConfig = readEncryptedConfig(sheetsIntegration.encryptedConfig);
  const aiConfig = readEncryptedConfig(aiIntegration.encryptedConfig);
  const transcriptRange = globalSkincareTranscriptRange();
  const transcriptTab = globalSkincareTranscriptTab();

  const table = await readGoogleSheetTable({ config: sheetsConfig, range: transcriptRange });
  const headers = table.headers;
  const phoneIndex = findColumn(headers, [/phone/, /mobile/, /whatsapp/, /^number$/, /contact.*number/, /^wa$/]);
  const nameIndex = findColumn(headers, [/name/, /customer/, /client/, /patient/]);
  const transcriptIndex = findColumn(headers, [/transcript/, /conversation/, /call.*(summary|notes|log|text)/, /summary/, /notes/, /^call$/]);
  const appointmentIndex = findColumn(headers, [/appointment/, /schedul/, /booking/, /slot/, /visit/]);
  let statusIndex = findColumn(headers, [/^status$/, /message.*status/, /outreach/, /follow.*up.*status/]);

  // Ensure a status column exists on the transcript tab for operator-visible
  // write-back. (This never targets crm_leads, so the spill-formula guard does
  // not apply here.)
  if (statusIndex === null) {
    const ensured = await ensureGoogleSheetStatusColumn({ config: sheetsConfig, range: transcriptRange, defaultStatus: "new" });
    statusIndex = ensured.statusColumnIndex;
  }
  const statusColumnIndex = statusIndex;

  const leadMs = globalSkincareReminderLeadMs();
  const sendGapMs = globalSkincareSendGapMs();
  const maxSends = Math.min(Math.max(1, Math.floor(maxRows)), globalSkincareMaxPerRun());
  const now = new Date();
  const results: GlobalSkincareAppointmentResult[] = [];
  let attemptedSends = 0;

  async function markSheet(rowNumber: number, status: string) {
    if (statusColumnIndex === null || statusColumnIndex < 0) return;
    try {
      await updateGoogleSheetLeadStatuses({
        config: sheetsConfig,
        range: transcriptRange,
        updates: [{ rowNumber, statusColumnIndex, status }]
      });
    } catch (error) {
      console.error("[global-skincare-appointments.sheet] status write failed", {
        tenantId,
        rowNumber,
        status,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const row of table.rows) {
    if (results.filter((result) => result.status === "sent" || result.status === "failed").length >= maxSends) {
      break;
    }

    const phone = pickPhone(row.cells, phoneIndex);
    if (!phone) {
      continue;
    }

    const sheetStatus = cellAt(row.cells, statusColumnIndex).toLowerCase();
    if (sheetStatus && sheetStatus !== "new") {
      // Already handled on a previous run (reminded / no_appointment / failed).
      continue;
    }

    const transcript = cellAt(row.cells, transcriptIndex);
    const explicitAppointment = cellAt(row.cells, appointmentIndex);
    if (!transcript && !explicitAppointment) {
      continue;
    }

    const name = cellAt(row.cells, nameIndex) || null;
    const upserted = await upsertTranscriptConversation({ tenantId, phone: phone.e164, name });
    let contact = upserted.contact;
    const conversation = upserted.conversation;
    const state = readGlobalSkincareAppointmentState(contact.customFields);

    if (state.remindedAt || (await alreadyRemindedInDb(tenantId, conversation.id))) {
      await markSheet(row.rowNumber, "reminded");
      results.push({ phone: phone.e164, status: "skipped", reason: "Appointment follow-up already sent", rowNumber: row.rowNumber });
      continue;
    }
    if (contact.optOut) {
      results.push({ phone: phone.e164, status: "skipped", reason: "Contact opted out", rowNumber: row.rowNumber });
      continue;
    }

    // Resolve the appointment: prefer an explicit sheet column, otherwise reuse a
    // cached AI extraction for the same transcript, otherwise extract via AI.
    const hash = transcriptHash(explicitAppointment ? `col:${explicitAppointment}` : transcript);
    let appointmentText: string | null;
    let appointmentAt: Date | null;
    let hasAppointment: boolean;

    if (explicitAppointment) {
      appointmentText = explicitAppointment;
      appointmentAt = parseAppointmentDate(explicitAppointment);
      hasAppointment = true;
    } else if (state.transcriptHash === hash && state.extractedAt) {
      appointmentText = state.appointmentText ?? null;
      appointmentAt = parseAppointmentDate(state.appointmentAt ?? null);
      hasAppointment = Boolean(state.hasAppointment);
    } else {
      const extracted = await extractAppointmentFromTranscript(aiConfig, transcript);
      await safeUsage({
        tenantId,
        provider: "ai",
        eventType: extracted ? "appointment.extracted" : "appointment.extract_failed",
        status: extracted ? "SUCCESS" : "FAILED",
        cost: 0,
        metadata: { conversationId: conversation.id, rowNumber: row.rowNumber }
      });
      if (!extracted) {
        results.push({ phone: phone.e164, status: "skipped", reason: "AI transcript analysis unavailable", rowNumber: row.rowNumber });
        continue;
      }
      appointmentText = extracted.appointmentText;
      appointmentAt = parseAppointmentDate(extracted.appointmentIso);
      hasAppointment = extracted.hasAppointment;

      const extractedState: GlobalSkincareAppointmentState = {
        ...state,
        transcriptHash: hash,
        extractedAt: now.toISOString(),
        hasAppointment,
        appointmentAt: extracted.appointmentIso,
        appointmentText,
        sourceTab: transcriptTab,
        sourceRow: row.rowNumber
      };
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: { customFields: withGlobalSkincareAppointmentState(contact.customFields, extractedState) as Prisma.InputJsonValue }
      });
    }

    if (!hasAppointment) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          customFields: withGlobalSkincareAppointmentState(contact.customFields, {
            ...readGlobalSkincareAppointmentState(contact.customFields),
            status: "no_appointment"
          }) as Prisma.InputJsonValue
        }
      });
      await markSheet(row.rowNumber, "no_appointment");
      results.push({ phone: phone.e164, status: "no_appointment", reason: "No appointment found in transcript", rowNumber: row.rowNumber });
      continue;
    }

    // Reminder window. Default (leadMs === null) sends immediately once the
    // appointment is known; a configured lead time waits until the appointment
    // is within that window. An unparseable date always sends now.
    const due = leadMs === null || !appointmentAt || now.getTime() >= appointmentAt.getTime() - leadMs;
    if (!due) {
      results.push({
        phone: phone.e164,
        status: "skipped",
        reason: `Waiting for reminder window (appointment ${appointmentText ?? "scheduled"})`,
        appointmentText,
        appointmentAt: appointmentAt?.toISOString() ?? null,
        rowNumber: row.rowNumber
      });
      continue;
    }

    if (attemptedSends > 0 && sendGapMs > 0) {
      await wait(sendGapMs);
    }
    attemptedSends += 1;

    const lead: WhatsAppTemplateLead = {
      name: contact.name,
      phone: contact.phone,
      appointment: appointmentText ?? "your appointment"
    };
    const templateMessage = await sendTemplateMessage({
      tenantId,
      templatePurpose: GLOBAL_SKINCARE_APPOINTMENT_TEMPLATE_ROLE,
      to: contact.phone,
      lead,
      config: templateMessageConfig
    });
    const { sendResult, template, templateConfig, variables } = templateMessage;
    const deliveryLimit =
      !sendResult.ok && isMetaDeliveryLimitError(sendResult.error)
        ? createMetaDeliveryLimit({ reason: sendResult.error })
        : null;

    const metadata = {
      adapter: GLOBAL_SKINCARE_APPOINTMENT_ADAPTER,
      sentByUserId: userId,
      templateName: template.name,
      templateLanguage: template.language,
      appointmentText,
      appointmentAt: appointmentAt?.toISOString() ?? null,
      sourceTab: transcriptTab,
      sourceRow: row.rowNumber,
      variableMode: templateConfig.variableMode,
      variableMappings: templateConfig.variables,
      variables
    };
    const outbound = await createOutboundConversationMessage({
      tenantId,
      conversationId: conversation.id,
      type: "TEMPLATE",
      templateId: template.id ?? undefined,
      body: templateMessage.body,
      whatsappMessageId: sendResult.whatsappMessageId,
      status: sendResult.ok ? "PENDING" : "FAILED",
      failureReason: sendResult.error ?? null,
      metadata: (deliveryLimit ? withMetaDeliveryLimitMetadata(metadata, deliveryLimit) : metadata) as Prisma.InputJsonObject
    });

    const currentState = readGlobalSkincareAppointmentState(contact.customFields);
    const nextFailures = (currentState.failures ?? 0) + (sendResult.ok ? 0 : 1);
    const nextState: GlobalSkincareAppointmentState = {
      ...currentState,
      hasAppointment: true,
      appointmentText,
      appointmentAt: appointmentAt?.toISOString() ?? currentState.appointmentAt ?? null,
      sourceTab: transcriptTab,
      sourceRow: row.rowNumber,
      ...(sendResult.ok
        ? { remindedAt: now.toISOString(), status: "reminded" }
        : {
            failures: nextFailures,
            lastFailureReason: sendResult.error ?? "WhatsApp send failed",
            ...(nextFailures >= globalSkincareMaxFailures() ? { status: "failed" as const } : {})
          })
    };
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: {
        customFields: (deliveryLimit
          ? withGlobalSkincareAppointmentState(
              withContactMetaDeliveryLimit(contact.customFields, deliveryLimit, outbound.message.id),
              nextState
            )
          : withGlobalSkincareAppointmentState(contact.customFields, nextState)) as Prisma.InputJsonValue
      }
    });

    if (sendResult.ok) {
      await markSheet(row.rowNumber, "reminded");
    } else if (nextFailures >= globalSkincareMaxFailures()) {
      await markSheet(row.rowNumber, "failed");
    }

    await safeUsage({
      tenantId,
      provider: "meta",
      eventType: sendResult.ok
        ? "appointment_follow_up.queued"
        : deliveryLimit
          ? "appointment_follow_up.meta_delivery_limited"
          : "appointment_follow_up.failed",
      status: sendResult.ok ? "SUCCESS" : "FAILED",
      cost: sendResult.ok ? 0.006 : 0,
      metadata: { conversationId: conversation.id, messageId: outbound.message.id, templateName: template.name }
    });

    const payload = {
      conversation: serializeConversation(outbound.conversation),
      message: serializeMessage(outbound.message)
    };
    emitTenantEvent(tenantId, "message.created", payload);
    emitTenantEvent(tenantId, "conversation.updated", payload.conversation);

    results.push({
      phone: contact.phone,
      status: sendResult.ok ? "sent" : "failed",
      reason: deliveryLimit ? metaDeliveryLimitReason(deliveryLimit) : (sendResult.error ?? undefined),
      conversationId: conversation.id,
      messageId: outbound.message.id,
      whatsappMessageId: sendResult.whatsappMessageId ?? null,
      appointmentText,
      appointmentAt: appointmentAt?.toISOString() ?? null,
      rowNumber: row.rowNumber
    });
  }

  return {
    scanned: table.rows.length,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    noAppointment: results.filter((result) => result.status === "no_appointment").length,
    templateMissing: false,
    results
  };
}
