import { prisma } from "@/lib/prisma";

// Disk retention. Supabase Pro includes 8 GB per project and bills $0.125/GB
// beyond it, so the append-only tables need a ceiling — nothing pruned them
// before this, and AuditLog alone reached 539k rows / 233 MB in about a month.
//
// Message, Conversation, Lead and friends are business records and are never
// touched here; only logs and dead auth rows are pruned.

const DAY_MS = 24 * 60 * 60 * 1000;

function retentionDays(name: string, fallback: number) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
}

function cutoff(days: number) {
  return new Date(Date.now() - days * DAY_MS);
}

export type RetentionSweepResult = {
  auditLogs: number;
  usageLogs: number;
  refreshTokens: number;
  auditBefore: string;
  usageBefore: string;
};

export async function runRetentionSweep(): Promise<RetentionSweepResult> {
  const auditBefore = cutoff(retentionDays("AUDIT_LOG_RETENTION_DAYS", 90));
  // Usage rows feed the admin billing pages, so they outlive audit rows.
  const usageBefore = cutoff(retentionDays("USAGE_LOG_RETENTION_DAYS", 365));

  const [auditLogs, usageLogs, refreshTokens] = await Promise.all([
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditBefore } } }),
    prisma.apiUsageLog.deleteMany({ where: { createdAt: { lt: usageBefore } } }),
    // Expired or revoked tokens can never be redeemed again — pure garbage that
    // accumulated on every login and refresh.
    prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }] }
    })
  ]);

  return {
    auditLogs: auditLogs.count,
    usageLogs: usageLogs.count,
    refreshTokens: refreshTokens.count,
    auditBefore: auditBefore.toISOString(),
    usageBefore: usageBefore.toISOString()
  };
}

type RetentionState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastRunAt: string | null;
  lastError: string | null;
  lastResult: RetentionSweepResult | null;
};

const globalForRetention = globalThis as unknown as { crmRetentionState?: RetentionState };

function retentionState() {
  globalForRetention.crmRetentionState ??= {
    started: false,
    timer: null,
    lastRunAt: null,
    lastError: null,
    lastResult: null
  };
  return globalForRetention.crmRetentionState;
}

function retentionDisabled() {
  return (
    process.env.RETENTION_SWEEP_DISABLED === "true" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    !process.env.DATABASE_URL?.trim()
  );
}

function sweepIntervalMs() {
  const value = Number(process.env.RETENTION_SWEEP_INTERVAL_MS);
  if (!Number.isFinite(value) || value <= 0) return DAY_MS;
  return Math.min(Math.max(Math.round(value), 60 * 60_000), 7 * DAY_MS);
}

/**
 * Daily retention sweep. Every statement is an idempotent deleteMany, so extra
 * app instances running it concurrently is harmless.
 */
export function startRetentionScheduler() {
  const state = retentionState();
  if (state.started || retentionDisabled()) return retentionStatus();

  state.started = true;

  const scheduleNextRun = (delayMs: number) => {
    state.timer = setTimeout(async () => {
      try {
        const result = await runRetentionSweep();
        state.lastResult = result;
        state.lastError = null;
        state.lastRunAt = new Date().toISOString();
        if (result.auditLogs || result.usageLogs || result.refreshTokens) {
          console.log("[retention] pruned", result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Retention sweep failed.";
        state.lastError = message;
        console.error("[retention] sweep failed", message);
      } finally {
        scheduleNextRun(sweepIntervalMs());
      }
    }, delayMs);
    state.timer.unref?.();
  };

  // Not on boot: let the app finish starting before touching the database.
  scheduleNextRun(60_000);
  return retentionStatus();
}

export function retentionStatus() {
  const state = retentionState();
  return {
    enabled: !retentionDisabled(),
    started: state.started,
    intervalMs: sweepIntervalMs(),
    lastRunAt: state.lastRunAt,
    lastError: state.lastError,
    lastResult: state.lastResult
  };
}
