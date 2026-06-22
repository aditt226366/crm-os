export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startLeadSheetAutoSyncScheduler } = await import("@/lib/lead-sheet-auto-sync");
    startLeadSheetAutoSyncScheduler();
  }
}
