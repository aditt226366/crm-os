import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api";
import type { IntegrationType } from "@/lib/constants";
import { runGoogleSheetLeadFlow } from "@/lib/lead-flow";
import { prisma } from "@/lib/prisma";

const REQUIRED_FLOW_INTEGRATIONS: IntegrationType[] = [
  "GOOGLE_SHEETS",
  "WHATSAPP_CLOUD",
  "WHATSAPP_TEMPLATE_SETTINGS",
  "KNOWLEDGE_BASE",
  "AI_MODEL"
];
const LEAD_SYNC_LEASE_MS = 120_000;

type LeadFlowInput = Parameters<typeof runGoogleSheetLeadFlow>[0];
type LeadFlowResult = Awaited<ReturnType<typeof runGoogleSheetLeadFlow>>;

type TenantCandidate = {
  id: string;
  name: string;
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
  reason?: string;
  missingIntegrations?: IntegrationType[];
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
  return process.env.LEAD_SHEET_SYNC_RANGE?.trim() || "A:Z";
}

function autoSyncDisabled() {
  return process.env.LEAD_SHEET_AUTO_SYNC_DISABLED === "true" || process.env.NEXT_PHASE === "phase-production-build";
}

function missingConnectedIntegrations(candidate: TenantCandidate) {
  const connected = new Set(
    candidate.integrations
      .filter((integration) => integration.status === "CONNECTED")
      .map((integration) => integration.type)
  );
  return REQUIRED_FLOW_INTEGRATIONS.filter((type) => !connected.has(type));
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
  range = configuredRange(),
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
        deliveryLimited: 0
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
            range,
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

        runs.push({
          tenantId: candidate.id,
          tenantName: candidate.name,
          actorUserId: actor.id,
          status: result.sent > 0 ? "sent" : "skipped",
          scanned: result.scanned,
          sent: result.sent,
          failed: result.failed,
          skipped: result.skipped,
          deliveryLimited: result.deliveryLimited,
          reason: result.sent > 0 ? undefined : "No new Sheet rows needed messaging."
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
        deliveryLimited: runs.reduce((sum, run) => sum + (run.deliveryLimited ?? 0), 0)
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
