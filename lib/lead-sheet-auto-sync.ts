import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api";
import type { IntegrationType } from "@/lib/constants";
import { CRM_LEADS_RANGE } from "@/lib/google-sheets-leads";
import { runGoogleSheetLeadFlow } from "@/lib/lead-flow";
import { prisma } from "@/lib/prisma";
import { runDueSourceCampaignSteps, type SourceCampaignRunResult } from "@/lib/source-campaigns";
import { isGlobalSkincareTenant } from "@/lib/global-skincare-config";
import { runGlobalSkincareAppointmentFollowUps } from "@/lib/global-skincare-appointments";

const REQUIRED_FLOW_INTEGRATIONS: IntegrationType[] = [
  "GOOGLE_SHEETS",
  "WHATSAPP_CLOUD",
  "WHATSAPP_TEMPLATE_SETTINGS",
  "KNOWLEDGE_BASE",
  "AI_MODEL"
];
// Global Skin Care's appointment follow-up flow does not require a knowledge base.
const GLOBAL_SKINCARE_REQUIRED_INTEGRATIONS: IntegrationType[] = [
  "GOOGLE_SHEETS",
  "WHATSAPP_CLOUD",
  "WHATSAPP_TEMPLATE_SETTINGS",
  "AI_MODEL"
];
const LEAD_SYNC_LEASE_MS = 120_000;

type LeadFlowInput = Parameters<typeof runGoogleSheetLeadFlow>[0];
type LeadFlowResult = Awaited<ReturnType<typeof runGoogleSheetLeadFlow>>;
type SourceCampaignResult = Pick<SourceCampaignRunResult, "scanned" | "sent" | "failed" | "skipped" | "stopped" | "completed">;

type TenantCandidate = {
  id: string;
  name: string;
  slug: string;
  integrations: Array<{ type: IntegrationType; status: string; lastVerificationError: string | null }>;
  users: Array<{ id: string; email: string; username: string; role: string }>;
};

type LeadSheetAutoSyncState = {
  started: boolean;
  runningScheduler: boolean;
  runningTenantIds: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastSummary: LeadSheetAutoSyncSummary | null;
};

export type LeadSheetAutoSyncTenantRun = {
  tenantId: string;
  tenantName: string;
  status: "sent" | "skipped" | "failed";
  actorUserId?: string;
  scanned?: number;
  sent?: number;
  failed?: number;
  skipped?: number;
  deliveryLimited?: number;
  sourceCampaigns?: SourceCampaignResult;
  reason?: string;
  missingIntegrations?: IntegrationType[];
  appointmentFollowUps?: {
    scanned: number;
    sent: number;
    failed: number;
    skipped: number;
    noAppointment: number;
    templateMissing: boolean;
  };
};

export type LeadSheetAutoSyncSummary = {
  trigger: string;
  startedAt: string;
  finishedAt: string;
  tenantsChecked: number;
  totals: {
    scanned: number;
    sent: number;
    failed: number;
    skipped: number;
    deliveryLimited: number;
    sourceCampaignsScanned: number;
    sourceCampaignsSent: number;
    sourceCampaignsFailed: number;
    sourceCampaignsSkipped: number;
    sourceCampaignsStopped: number;
    sourceCampaignsCompleted: number;
  };
  runs: LeadSheetAutoSyncTenantRun[];
};

const globalForLeadSheetAutoSync = globalThis as unknown as {
  leadSheetAutoSyncState?: LeadSheetAutoSyncState;
};

function autoSyncState() {
  globalForLeadSheetAutoSync.leadSheetAutoSyncState ??= {
    started: false,
    runningScheduler: false,
    runningTenantIds: new Set<string>(),
    timer: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastSummary: null
  };
  return globalForLeadSheetAutoSync.leadSheetAutoSyncState;
}

function configuredIntervalMs() {
  const value = Number(process.env.LEAD_SHEET_SYNC_INTERVAL_MS);
  if (!Number.isFinite(value) || value <= 0) return 5_000;
  return Math.min(Math.max(Math.round(value), 5_000), 300_000);
}

function configuredMaxRows() {
  const value = Number(process.env.LEAD_SHEET_SYNC_MAX_ROWS);
  if (!Number.isFinite(value) || value <= 0) return 200;
  return Math.min(Math.max(Math.round(value), 1), 200);
}

function configuredRange() {
  return CRM_LEADS_RANGE;
}

function autoSyncDisabled() {
  return (
    process.env.LEAD_SHEET_AUTO_SYNC_DISABLED === "true" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    // No database configured (e.g. local UI work): don't start the DB-polling
    // scheduler, which would otherwise throw on every tick.
    !process.env.DATABASE_URL?.trim()
  );
}

function missingConnectedIntegrations(
  candidate: TenantCandidate,
  required: IntegrationType[] = REQUIRED_FLOW_INTEGRATIONS
) {
  const connected = new Set(
    candidate.integrations
      .filter((integration) => integration.status === "CONNECTED")
      .map((integration) => integration.type)
  );
  return required.filter((type) => !connected.has(type));
}

async function leadSyncTenantCandidates(tenantId?: string) {
  return prisma.tenant.findMany({
    where: {
      ...(tenantId ? { id: tenantId } : {}),
      status: "ACTIVE",
      features: {
        some: {
          featureKey: "LEAD_MANAGEMENT",
          enabled: true
        }
      },
      integrations: {
        some: {
          type: "GOOGLE_SHEETS",
          status: "CONNECTED"
        }
      }
    },
    select: {
      id: true,
      name: true,
      slug: true,
      integrations: {
        where: {
          type: { in: REQUIRED_FLOW_INTEGRATIONS }
        },
        select: {
          type: true,
          status: true,
          lastVerificationError: true
        }
      },
      users: {
        where: {
          status: "ACTIVE",
          role: { in: ["COMPANY_OWNER", "COMPANY_AGENT"] }
        },
        orderBy: [{ role: "asc" }, { updatedAt: "desc" }],
        take: 5,
        select: {
          id: true,
          email: true,
          username: true,
          role: true
        }
      }
    }
  });
}

async function acquireTenantSyncLease(tenantId: string) {
  const leaseId = randomUUID();
  const leaseUntil = new Date(Date.now() + LEAD_SYNC_LEASE_MS).toISOString();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public."Integration"
    SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
      'leadSheetSyncLeaseId', ${leaseId},
      'leadSheetSyncLeaseUntil', ${leaseUntil}
    )
    WHERE "tenantId" = ${tenantId}
      AND "type"::text = 'GOOGLE_SHEETS'
      AND (
        "metadata" IS NULL
        OR "metadata"->>'leadSheetSyncLeaseUntil' IS NULL
        OR ("metadata"->>'leadSheetSyncLeaseUntil')::timestamptz < now()
      )
    RETURNING "id"
  `;

  return rows.length ? leaseId : null;
}

async function releaseTenantSyncLease(tenantId: string, leaseId: string) {
  try {
    await prisma.$executeRaw`
      UPDATE public."Integration"
      SET "metadata" = (COALESCE("metadata", '{}'::jsonb) - 'leadSheetSyncLeaseId' - 'leadSheetSyncLeaseUntil') ||
        jsonb_build_object('leadSheetSyncLastFinishedAt', ${new Date().toISOString()})
      WHERE "tenantId" = ${tenantId}
        AND "type"::text = 'GOOGLE_SHEETS'
        AND "metadata"->>'leadSheetSyncLeaseId' = ${leaseId}
    `;
  } catch (error) {
    console.error("[lead-sheet-auto-sync] failed to release tenant sync lease", {
      tenantId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function runGoogleSheetLeadFlowWithTenantLock(
  input: LeadFlowInput,
  options: { skipIfRunning?: boolean } = {}
): Promise<LeadFlowResult | null> {
  const state = autoSyncState();
  if (state.runningTenantIds.has(input.tenantId)) {
    if (options.skipIfRunning) return null;
    throw new ApiError(409, "LEAD_FLOW_ALREADY_RUNNING", "Lead sheet sync is already running for this company.");
  }

  state.runningTenantIds.add(input.tenantId);
  const leaseId = await acquireTenantSyncLease(input.tenantId);
  if (!leaseId) {
    state.runningTenantIds.delete(input.tenantId);
    if (options.skipIfRunning) return null;
    throw new ApiError(409, "LEAD_FLOW_ALREADY_RUNNING", "Lead sheet sync is already running for this company.");
  }

  try {
    return await runGoogleSheetLeadFlow(input);
  } finally {
    await releaseTenantSyncLease(input.tenantId, leaseId);
    state.runningTenantIds.delete(input.tenantId);
  }
}

export async function runDueGoogleSheetLeadFlows({
  trigger = "scheduler",
  tenantId,
  maxRows = configuredMaxRows()
}: {
  trigger?: string;
  tenantId?: string;
  range?: string;
  maxRows?: number;
} = {}): Promise<LeadSheetAutoSyncSummary> {
  const state = autoSyncState();
  const startedAt = new Date().toISOString();

  if (!tenantId && state.runningScheduler) {
    const finishedAt = new Date().toISOString();
    return {
      trigger,
      startedAt,
      finishedAt,
      tenantsChecked: 0,
      totals: {
        scanned: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        deliveryLimited: 0,
        sourceCampaignsScanned: 0,
        sourceCampaignsSent: 0,
        sourceCampaignsFailed: 0,
        sourceCampaignsSkipped: 0,
        sourceCampaignsStopped: 0,
        sourceCampaignsCompleted: 0
      },
      runs: [
        {
          tenantId: "all",
          tenantName: "All tenants",
          status: "skipped",
          reason: "Lead sheet sync is already running."
        }
      ]
    };
  }

  state.runningScheduler = !tenantId;
  state.lastStartedAt = startedAt;
  state.lastError = null;

  try {
    const candidates = await leadSyncTenantCandidates(tenantId);
    const runs: LeadSheetAutoSyncTenantRun[] = [];

    for (const candidate of candidates) {
      // Company-specific (Global Skin Care): if a call-transcript tab is present,
      // run the AI appointment follow-up as an ADDITIONAL best-effort step. This
      // no longer replaces the normal lead-drip flow — Global Skin Care falls
      // through to the generic flow below so its ad-form / sheet leads still get
      // their welcome + drip templates.
      if (isGlobalSkincareTenant(candidate)) {
        const gscActor = candidate.users.find((user) => user.role === "COMPANY_OWNER") ?? candidate.users[0];
        const gscMissing = missingConnectedIntegrations(candidate, GLOBAL_SKINCARE_REQUIRED_INTEGRATIONS);
        if (gscActor && !gscMissing.length) {
          try {
            const appointment = await runGlobalSkincareAppointmentFollowUps({
              tenantId: candidate.id,
              userId: gscActor.id,
              maxRows
            });
            runs.push({
              tenantId: candidate.id,
              tenantName: candidate.name,
              actorUserId: gscActor.id,
              status: appointment.sent > 0 ? "sent" : "skipped",
              appointmentFollowUps: {
                scanned: appointment.scanned,
                sent: appointment.sent,
                failed: appointment.failed,
                skipped: appointment.skipped,
                noAppointment: appointment.noAppointment,
                templateMissing: appointment.templateMissing
              },
              reason:
                appointment.reason ??
                (appointment.sent > 0 ? undefined : "No transcripts needed an appointment follow-up.")
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Appointment follow-up run failed.";
            console.error("[lead-sheet-auto-sync] global skincare appointment run failed (non-fatal)", {
              tenantId: candidate.id,
              error: message
            });
          }
        }
        // No `continue` — fall through to the generic sheet-drip flow below.
      }

      const missingIntegrations = missingConnectedIntegrations(candidate);
      if (missingIntegrations.length) {
        runs.push({
          tenantId: candidate.id,
          tenantName: candidate.name,
          status: "skipped",
          reason: `Missing connected integrations: ${missingIntegrations.join(", ")}`,
          missingIntegrations
        });
        continue;
      }

      const actor = candidate.users.find((user) => user.role === "COMPANY_OWNER") ?? candidate.users[0];
      if (!actor) {
        runs.push({
          tenantId: candidate.id,
          tenantName: candidate.name,
          status: "skipped",
          reason: "No active company user found for automatic lead sync."
        });
        continue;
      }

      try {
        const result = await runGoogleSheetLeadFlowWithTenantLock(
          {
            tenantId: candidate.id,
            userId: actor.id,
            maxRows
          },
          { skipIfRunning: true }
        );

        if (!result) {
          runs.push({
            tenantId: candidate.id,
            tenantName: candidate.name,
            actorUserId: actor.id,
            status: "skipped",
            reason: "Lead sheet sync is already running for this company."
          });
          continue;
        }

        const sourceCampaigns = await runDueSourceCampaignSteps({
          tenantId: candidate.id,
          userId: actor.id
        });
        const anySent =
          result.sent > 0 ||
          sourceCampaigns.sent > 0 ||
          sourceCampaigns.completed > 0;
        runs.push({
          tenantId: candidate.id,
          tenantName: candidate.name,
          actorUserId: actor.id,
          status: anySent ? "sent" : "skipped",
          scanned: result.scanned,
          sent: result.sent,
          failed: result.failed,
          skipped: result.skipped,
          deliveryLimited: result.deliveryLimited,
          sourceCampaigns: {
            scanned: sourceCampaigns.scanned,
            sent: sourceCampaigns.sent,
            failed: sourceCampaigns.failed,
            skipped: sourceCampaigns.skipped,
            stopped: sourceCampaigns.stopped,
            completed: sourceCampaigns.completed
          },
          reason: anySent ? undefined : "No new Sheet rows needed messaging."
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Lead sheet sync failed.";
        runs.push({
          tenantId: candidate.id,
          tenantName: candidate.name,
          actorUserId: actor.id,
          status: "failed",
          reason: message
        });
        console.error("[lead-sheet-auto-sync] tenant sync failed", {
          tenantId: candidate.id,
          tenantName: candidate.name,
          error: message
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const summary: LeadSheetAutoSyncSummary = {
      trigger,
      startedAt,
      finishedAt,
      tenantsChecked: candidates.length,
      totals: {
        scanned: runs.reduce((sum, run) => sum + (run.scanned ?? 0), 0),
        sent: runs.reduce((sum, run) => sum + (run.sent ?? 0), 0),
        failed: runs.reduce((sum, run) => sum + (run.failed ?? (run.status === "failed" ? 1 : 0)), 0),
        skipped: runs.reduce((sum, run) => sum + (run.skipped ?? (run.status === "skipped" ? 1 : 0)), 0),
        deliveryLimited: runs.reduce((sum, run) => sum + (run.deliveryLimited ?? 0), 0),
        sourceCampaignsScanned: runs.reduce((sum, run) => sum + (run.sourceCampaigns?.scanned ?? 0), 0),
        sourceCampaignsSent: runs.reduce((sum, run) => sum + (run.sourceCampaigns?.sent ?? 0), 0),
        sourceCampaignsFailed: runs.reduce((sum, run) => sum + (run.sourceCampaigns?.failed ?? 0), 0),
        sourceCampaignsSkipped: runs.reduce((sum, run) => sum + (run.sourceCampaigns?.skipped ?? 0), 0),
        sourceCampaignsStopped: runs.reduce((sum, run) => sum + (run.sourceCampaigns?.stopped ?? 0), 0),
        sourceCampaignsCompleted: runs.reduce((sum, run) => sum + (run.sourceCampaigns?.completed ?? 0), 0)
      },
      runs
    };

    state.lastFinishedAt = finishedAt;
    state.lastSummary = summary;
    return summary;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "Lead sheet auto sync failed.";
    throw error;
  } finally {
    if (!tenantId) {
      state.runningScheduler = false;
    }
  }
}

export function startLeadSheetAutoSyncScheduler() {
  const state = autoSyncState();
  if (state.started || autoSyncDisabled()) return leadSheetAutoSyncStatus();

  state.started = true;

  const scheduleNextRun = (delayMs: number) => {
    state.timer = setTimeout(async () => {
      try {
        await runDueGoogleSheetLeadFlows({ trigger: "scheduler" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Lead sheet auto sync failed.";
        state.lastError = message;
        console.error("[lead-sheet-auto-sync] scheduler failed", message);
      } finally {
        scheduleNextRun(configuredIntervalMs());
      }
    }, delayMs);
    state.timer.unref?.();
  };

  scheduleNextRun(2_000);
  return leadSheetAutoSyncStatus();
}

export function leadSheetAutoSyncStatus() {
  const state = autoSyncState();
  return {
    enabled: !autoSyncDisabled(),
    started: state.started,
    runningScheduler: state.runningScheduler,
    runningTenantIds: Array.from(state.runningTenantIds),
    intervalMs: configuredIntervalMs(),
    range: configuredRange(),
    maxRows: configuredMaxRows(),
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastError: state.lastError,
    lastSummary: state.lastSummary
  };
}
