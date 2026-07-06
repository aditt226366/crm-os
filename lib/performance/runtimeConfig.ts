export const isEgressSafeMode = process.env.EGRESS_SAFE_MODE === "true";

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
