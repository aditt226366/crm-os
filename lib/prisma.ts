import { PrismaClient } from "@prisma/client";
import { databaseEnvCheck } from "@/lib/db-env";

const isProductionRuntime =
  process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";

if (isProductionRuntime && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required before Prisma Client can start in production.");
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaDbEnvLogged?: boolean;
};

if (isProductionRuntime && !globalForPrisma.prismaDbEnvLogged) {
  const env = databaseEnvCheck();
  console.log("[db.env]", {
    hasDatabaseUrl: env.hasDatabaseUrl,
    databaseUrlHost: env.databaseHostMasked,
    databaseUserPrefix: env.databaseUserMasked
  });
  globalForPrisma.prismaDbEnvLogged = true;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
