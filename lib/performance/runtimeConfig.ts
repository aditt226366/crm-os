// Safe mode is now the default in production. The aggressive intervals below
// (a 4s poll for the open chat, 8s for the list) cost ~32k requests/day per open
// tab, which is the single largest driver of Supabase egress — billed at
// $0.09/GB past the 250 GB included in Pro. Live updates still arrive instantly
// over SSE (lib/realtime.ts); polling is only the fallback, so the slower
// cadence costs nothing perceptible.
//
// EGRESS_SAFE_MODE="false" restores the fast intervals, "true" forces them off.
const egressSafeModeSetting = process.env.EGRESS_SAFE_MODE?.trim().toLowerCase();
export const isEgressSafeMode =
  egressSafeModeSetting === "true"
    ? true
    : egressSafeModeSetting === "false"
      ? false
      : process.env.NODE_ENV === "production";

export const runtimeConfig = {
  dashboardCacheMs: isEgressSafeMode ? 60_000 : 15_000,
  inboxListRefreshMs: isEgressSafeMode ? 30_000 : 8_000,
  selectedChatRefreshMs: isEgressSafeMode ? 15_000 : 4_000,
  leadListRefreshMs: isEgressSafeMode ? 60_000 : 20_000,
  integrationStatusCacheMs: isEgressSafeMode ? 60_000 : 20_000,
  featuresWorkspaceCacheMs: 5 * 60_000,
  initialConversationLimit: isEgressSafeMode ? 25 : 50,
  initialMessageLimit: isEgressSafeMode ? 50 : 100,
  initialLeadLimit: isEgressSafeMode ? 50 : 100
};
