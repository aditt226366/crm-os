import { prisma } from "../lib/prisma";
import { runRetentionSweep } from "../lib/maintenance";

// Manual trigger for the same sweep the app now runs daily (lib/maintenance.ts).
// Useful for a one-off reclaim after the tables have already grown.
runRetentionSweep()
  .then((result) => {
    console.log("[cleanup.logs]", result);
    console.log(
      "[cleanup.logs] note: Postgres does not hand deleted space back to disk until the table is " +
        'vacuumed. Run VACUUM FULL "AuditLog"; in the SQL editor if you need the space back now.'
    );
  })
  .catch((error) => {
    console.error("[cleanup.logs] failed", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
