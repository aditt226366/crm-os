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
  let url = process.env.DATABASE_URL;
  if (!url) {
    return url;
  }

  if (process.platform === "win32") {
    url = url.replace(/sslmode=require/g, "sslmode=disable");
  }

  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", "1");
    }
    return parsed.toString();
  } catch {
    return url;
  }
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
