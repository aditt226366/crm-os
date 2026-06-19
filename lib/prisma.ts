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

function prismaDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url || process.platform !== "win32") {
    return url;
  }

  return url.replace(/sslmode=require/g, "sslmode=disable");
}

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
    datasources: prismaDatabaseUrl() ? { db: { url: prismaDatabaseUrl()! } } : undefined,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
