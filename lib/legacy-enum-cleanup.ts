import { prisma } from "@/lib/prisma";

// Voice Agents were removed from the product, so VOICE_AGENT / VOICE_AGENTS are
// gone from the Prisma enums — but existing databases still hold rows carrying
// those values. Prisma throws when it deserializes an enum value it does not
// know, so a single leftover row would 500 the admin console integrations list,
// the feature guards, and the billing pages. These statements purge the dead
// config and re-bucket the usage history (the rows keep their provider and
// eventType, so the voice origin is still visible in the log).
//
// Written as text comparisons so they are safe on a fresh database where the
// Postgres enum never had the value in the first place.
const statements = [
  `DELETE FROM public."Integration" WHERE "type"::text = 'VOICE_AGENT';`,
  `DELETE FROM public."TenantFeature" WHERE "featureKey"::text = 'VOICE_AGENTS';`,
  `UPDATE public."ApiUsageLog" SET "featureKey" = 'AI_AGENTS' WHERE "featureKey"::text = 'VOICE_AGENTS';`
];

let cleanupPromise: Promise<void> | null = null;
let cleanupDone = false;

export async function purgeRemovedVoiceAgentRows() {
  if (cleanupDone) return;

  cleanupPromise ??= (async () => {
    for (const statement of statements) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch (error) {
        // A missing table (fresh install, partial bootstrap) is not fatal here.
        console.warn(
          "[legacy-cleanup] voice agent row cleanup skipped",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    cleanupDone = true;
  })().finally(() => {
    cleanupPromise = null;
  });

  await cleanupPromise;
}
