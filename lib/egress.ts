import type { FeatureKey, IntegrationType } from "@/lib/constants";
import { isEgressSafeMode, runtimeConfig } from "@/lib/performance/runtimeConfig";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type DashboardPayload = unknown;
type IntegrationStatusPayload = unknown;
type FeaturePayload = {
  features: Array<{
    id: string;
    featureKey: FeatureKey;
    name: string;
    description: string;
    navLabel: string;
    route: string;
    enabled: boolean;
    updatedAt: string;
    updatedBy: { name: string; email: string } | null;
  }>;
  navigation: Array<{ featureKey: FeatureKey; label: string; href: string }>;
};

type EgressStats = {
  largeResponses: Array<{
    route: string;
    status: number;
    responseBytes: number;
    tenantId: string | null;
    durationMs: number | null;
    at: string;
  }>;
  routeCalls: Map<string, { route: string; count: number; responseBytes: number; lastCalledAt: string }>;
};

const globalEgress = globalThis as unknown as {
  crmDashboardCache?: Map<string, CacheEntry<DashboardPayload>>;
  crmIntegrationStatusCache?: Map<string, CacheEntry<IntegrationStatusPayload>>;
  crmFeatureCache?: Map<string, CacheEntry<FeaturePayload>>;
  crmEgressStats?: EgressStats;
};

export const EGRESS_SAFE_MODE = isEgressSafeMode;
export const DASHBOARD_CACHE_TTL_MS = runtimeConfig.dashboardCacheMs;
export const INTEGRATION_STATUS_CACHE_TTL_MS = runtimeConfig.integrationStatusCacheMs;
export const FEATURE_CACHE_TTL_MS = runtimeConfig.featuresWorkspaceCacheMs;
export const DEFAULT_CONVERSATION_LIMIT = runtimeConfig.initialConversationLimit;
export const MAX_CONVERSATION_LIMIT = runtimeConfig.initialConversationLimit;
export const DEFAULT_MESSAGE_LIMIT = runtimeConfig.initialMessageLimit;
export const MAX_MESSAGE_LIMIT = runtimeConfig.initialMessageLimit;
export const DEFAULT_LIST_LIMIT = runtimeConfig.initialLeadLimit;
export const MAX_LIST_LIMIT = runtimeConfig.initialLeadLimit;
export const INBOX_LIST_POLL_MS = runtimeConfig.inboxListRefreshMs;
export const SELECTED_CONVERSATION_POLL_MS = runtimeConfig.selectedChatRefreshMs;
export const DASHBOARD_REFRESH_MS = runtimeConfig.dashboardCacheMs;

export const dashboardCache = globalEgress.crmDashboardCache ?? new Map<string, CacheEntry<DashboardPayload>>();
export const integrationStatusCache =
  globalEgress.crmIntegrationStatusCache ?? new Map<string, CacheEntry<IntegrationStatusPayload>>();
export const featureCache = globalEgress.crmFeatureCache ?? new Map<string, CacheEntry<FeaturePayload>>();
globalEgress.crmDashboardCache = dashboardCache;
globalEgress.crmIntegrationStatusCache = integrationStatusCache;
globalEgress.crmFeatureCache = featureCache;

const egressStats: EgressStats =
  globalEgress.crmEgressStats ??
  {
    largeResponses: [],
    routeCalls: new Map()
  };
globalEgress.crmEgressStats = egressStats;

export function parseBoundedLimit({
  searchParams,
  names = ["limit", "take"],
  defaultLimit,
  maxLimit
}: {
  searchParams: URLSearchParams;
  names?: string[];
  defaultLimit: number;
  maxLimit: number;
}) {
  const raw = names.map((name) => searchParams.get(name)).find(Boolean);
  const parsed = raw ? Number(raw) : defaultLimit;
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(Math.floor(parsed), maxLimit);
}

export function parseOptionalDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getCache<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

export function invalidateTenantEgressCaches(tenantId: string) {
  dashboardCache.delete(tenantId);
  integrationStatusCache.delete(tenantId);
  featureCache.delete(tenantId);
}

export function invalidateTenantIntegrationCache(tenantId: string) {
  integrationStatusCache.delete(tenantId);
}

export function safeMetadataSummary(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  return {
    lastSyncAt: typeof record.lastSyncAt === "string" ? record.lastSyncAt : null,
    lastSyncedAt: typeof record.lastSyncedAt === "string" ? record.lastSyncedAt : null,
    verifiedAt: typeof record.verifiedAt === "string" ? record.verifiedAt : null,
    provider: typeof record.provider === "string" ? record.provider : null
  };
}

export function compactIntegrationStatus(input: {
  type: IntegrationType;
  status?: string | null;
  maskedDisplay?: unknown;
  metadata?: unknown;
  lastVerifiedAt?: Date | null;
  lastVerificationError?: string | null;
}) {
  return {
    type: input.type,
    status: input.status ?? "NOT_CONNECTED",
    connected: input.status === "CONNECTED",
    maskedDisplay: input.maskedDisplay ?? null,
    metadata: safeMetadataSummary(input.metadata),
    lastVerifiedAt: input.lastVerifiedAt?.toISOString() ?? null,
    lastVerificationError: input.lastVerificationError ?? null
  };
}

export function recordApiResponseSize({
  route,
  status,
  responseBytes,
  tenantId,
  durationMs
}: {
  route: string;
  status: number;
  responseBytes: number;
  tenantId?: string | null;
  durationMs?: number | null;
}) {
  const normalizedRoute = route || "unknown";
  const now = new Date().toISOString();
  const existing = egressStats.routeCalls.get(normalizedRoute);
  egressStats.routeCalls.set(normalizedRoute, {
    route: normalizedRoute,
    count: (existing?.count ?? 0) + 1,
    responseBytes: (existing?.responseBytes ?? 0) + responseBytes,
    lastCalledAt: now
  });

  if (responseBytes > 200 * 1024) {
    const entry = {
      route: normalizedRoute,
      status,
      responseBytes,
      tenantId: tenantId ?? null,
      durationMs: durationMs ?? null,
      at: now
    };
    console.warn("[egress.large-response]", entry);
    egressStats.largeResponses.unshift(entry);
    egressStats.largeResponses = egressStats.largeResponses.slice(0, 50);
  }
}

export function getEgressDiagnostics() {
  const routes = [...egressStats.routeCalls.values()]
    .map((route) => ({
      ...route,
      averageResponseBytes: route.count ? Math.round(route.responseBytes / route.count) : 0
    }))
    .sort((a, b) => b.responseBytes - a.responseBytes)
    .slice(0, 50);

  return {
    safeMode: EGRESS_SAFE_MODE,
    polling: {
      inboxListMs: INBOX_LIST_POLL_MS,
      selectedConversationMs: SELECTED_CONVERSATION_POLL_MS,
      dashboardRefreshMs: DASHBOARD_REFRESH_MS
    },
    cache: {
      dashboardEntries: dashboardCache.size,
      integrationStatusEntries: integrationStatusCache.size,
      featureEntries: featureCache.size
    },
    largeResponses: egressStats.largeResponses,
    routes,
    warnings: [
      "Keep inbox lists paginated and message history lazy-loaded.",
      "Do not expose knowledge chunks or integration secrets in frontend API responses.",
      "Use EGRESS_SAFE_MODE=true only when strict egress-saving polling and cache windows are required."
    ]
  };
}
