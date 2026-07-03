import { prisma } from "@/lib/prisma";
import { databaseEnvCheck } from "@/lib/db-env";

type DatabaseRow = {
  currentDatabase: string;
  currentSchema: string;
  currentUser: string;
};

export type IntegrationColumnDiagnostic = {
  columnName: string;
  dataType: string;
  udtName: string;
  isNullable: string;
  defaultValue: string | null;
};

type FailedMigrationRow = {
  activeFailedCount: number;
};

type ConstraintRow = {
  constraintName: string;
};

type ExistsRow = {
  exists: boolean;
};

export type IntegrationDiagnostics = {
  database: DatabaseRow;
  integrationTable: {
    exists: boolean;
    columns: IntegrationColumnDiagnostic[];
    hasMetadata: boolean;
    hasEncryptedConfig: boolean;
    hasMaskedDisplay: boolean;
  };
  failedMigrations: {
    activeFailedCount: number;
  };
  badConstraints: {
    userForeignKeys: string[];
  };
  envCheck: {
    hasDatabaseUrl: boolean;
    databaseHostMasked: string | null;
    databaseUserMasked: string | null;
  };
};

let integrationSchemaReady = false;
let integrationSchemaPromise: Promise<void> | null = null;

async function getFailedMigrationCount() {
  const existsRows = await prisma.$queryRaw<ExistsRow[]>`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists";
  `;

  if (!existsRows[0]?.exists) {
    return 0;
  }

  const failedRows = await prisma.$queryRaw<FailedMigrationRow[]>`
    SELECT CAST(COUNT(*) AS INTEGER) AS "activeFailedCount"
    FROM public."_prisma_migrations"
    WHERE "finished_at" IS NULL
    AND "rolled_back_at" IS NULL;
  `;

  return failedRows[0]?.activeFailedCount ?? 0;
}

export async function getIntegrationDiagnostics(): Promise<IntegrationDiagnostics> {
  const [databaseRows, columnRows, failedCount, constraintRows] = await Promise.all([
    prisma.$queryRaw<DatabaseRow[]>`
      SELECT
        current_database() AS "currentDatabase",
        current_schema() AS "currentSchema",
        current_user AS "currentUser";
    `,
    prisma.$queryRaw<IntegrationColumnDiagnostic[]>`
      SELECT
        column_name AS "columnName",
        data_type AS "dataType",
        udt_name AS "udtName",
        is_nullable AS "isNullable",
        column_default AS "defaultValue"
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'Integration'
      ORDER BY ordinal_position;
    `,
    getFailedMigrationCount(),
    prisma.$queryRaw<ConstraintRow[]>`
      SELECT conname AS "constraintName"
      FROM pg_constraint
      WHERE conname IN (
        'Integration_createdById_fkey',
        'Integration_updatedById_fkey'
      )
      ORDER BY conname;
    `
  ]);

  const hasColumn = (columnName: string) => columnRows.some((column) => column.columnName === columnName);

  return {
    database: databaseRows[0] ?? {
      currentDatabase: "unknown",
      currentSchema: "unknown",
      currentUser: "unknown"
    },
    integrationTable: {
      exists: columnRows.length > 0,
      columns: columnRows,
      hasMetadata: hasColumn("metadata"),
      hasEncryptedConfig: hasColumn("encryptedConfig"),
      hasMaskedDisplay: hasColumn("maskedDisplay")
    },
    failedMigrations: {
      activeFailedCount: failedCount
    },
    badConstraints: {
      userForeignKeys: constraintRows.map((row) => row.constraintName)
    },
    envCheck: databaseEnvCheck()
  };
}

const repairStatements = [
  `DO $$
BEGIN
  CREATE TYPE public."IntegrationType" AS ENUM (
    'GOOGLE_SHEETS',
    'WHATSAPP_CLOUD',
    'WHATSAPP_TEMPLATE_SETTINGS',
    'META_ADS',
    'KNOWLEDGE_BASE',
    'AI_MODEL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `ALTER TYPE public."IntegrationType" ADD VALUE IF NOT EXISTS 'GOOGLE_SHEETS';`,
  `ALTER TYPE public."IntegrationType" ADD VALUE IF NOT EXISTS 'WHATSAPP_CLOUD';`,
  `ALTER TYPE public."IntegrationType" ADD VALUE IF NOT EXISTS 'WHATSAPP_TEMPLATE_SETTINGS';`,
  `ALTER TYPE public."IntegrationType" ADD VALUE IF NOT EXISTS 'META_ADS';`,
  `ALTER TYPE public."IntegrationType" ADD VALUE IF NOT EXISTS 'KNOWLEDGE_BASE';`,
  `ALTER TYPE public."IntegrationType" ADD VALUE IF NOT EXISTS 'AI_MODEL';`,
  `DO $$
BEGIN
  CREATE TYPE public."IntegrationStatus" AS ENUM (
    'CONNECTED',
    'NOT_CONNECTED',
    'ERROR',
    'PARTIALLY_CONNECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `ALTER TYPE public."IntegrationStatus" ADD VALUE IF NOT EXISTS 'CONNECTED';`,
  `ALTER TYPE public."IntegrationStatus" ADD VALUE IF NOT EXISTS 'NOT_CONNECTED';`,
  `ALTER TYPE public."IntegrationStatus" ADD VALUE IF NOT EXISTS 'ERROR';`,
  `ALTER TYPE public."IntegrationStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_CONNECTED';`,
  `CREATE TABLE IF NOT EXISTS public."Integration" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "type" public."IntegrationType" NOT NULL,
  "status" public."IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
  "encryptedConfig" JSONB,
  "maskedDisplay" JSONB,
  "metadata" JSONB,
  "lastVerifiedAt" TIMESTAMP(3),
  "lastVerificationError" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."Integration" ADD COLUMN IF NOT EXISTS "metadata" JSONB;`,
  `ALTER TABLE public."Integration" ADD COLUMN IF NOT EXISTS "encryptedConfig" JSONB;`,
  `ALTER TABLE public."Integration" ADD COLUMN IF NOT EXISTS "maskedDisplay" JSONB;`,
  `ALTER TABLE public."Integration" ADD COLUMN IF NOT EXISTS "lastVerifiedAt" TIMESTAMP(3);`,
  `ALTER TABLE public."Integration" ADD COLUMN IF NOT EXISTS "lastVerificationError" TEXT;`,
  `ALTER TABLE public."Integration" ADD COLUMN IF NOT EXISTS "createdById" TEXT;`,
  `ALTER TABLE public."Integration" ADD COLUMN IF NOT EXISTS "updatedById" TEXT;`,
  `ALTER TABLE public."Integration" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Integration" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Integration" DROP CONSTRAINT IF EXISTS "Integration_createdById_fkey";`,
  `ALTER TABLE public."Integration" DROP CONSTRAINT IF EXISTS "Integration_updatedById_fkey";`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Integration_tenantId_type_key" ON public."Integration"("tenantId", "type");`,
  `CREATE INDEX IF NOT EXISTS "Integration_tenantId_idx" ON public."Integration"("tenantId");`,
  `CREATE INDEX IF NOT EXISTS "Integration_type_idx" ON public."Integration"("type");`,
  `CREATE INDEX IF NOT EXISTS "Integration_status_idx" ON public."Integration"("status");`,
  `DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'UPDATE public."_prisma_migrations"
      SET "rolled_back_at" = NOW()
      WHERE "finished_at" IS NULL
      AND "rolled_back_at" IS NULL';
  END IF;
END $$;`
];

function needsRepair(diagnostics: IntegrationDiagnostics) {
  return (
    !diagnostics.integrationTable.exists ||
    !diagnostics.integrationTable.hasMetadata ||
    !diagnostics.integrationTable.hasEncryptedConfig ||
    !diagnostics.integrationTable.hasMaskedDisplay ||
    diagnostics.badConstraints.userForeignKeys.length > 0 ||
    diagnostics.failedMigrations.activeFailedCount > 0
  );
}

export async function repairIntegrationSchema() {
  for (const statement of repairStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const diagnostics = await getIntegrationDiagnostics();
  integrationSchemaReady = !needsRepair(diagnostics);
  return diagnostics;
}

export async function ensureIntegrationSchema() {
  if (integrationSchemaReady) return;

  integrationSchemaPromise ??= (async () => {
    const diagnostics = await getIntegrationDiagnostics();

    if (needsRepair(diagnostics)) {
      console.warn("[integrations.schema] repairing Integration schema", {
        exists: diagnostics.integrationTable.exists,
        hasMetadata: diagnostics.integrationTable.hasMetadata,
        hasEncryptedConfig: diagnostics.integrationTable.hasEncryptedConfig,
        hasMaskedDisplay: diagnostics.integrationTable.hasMaskedDisplay,
        activeFailedMigrations: diagnostics.failedMigrations.activeFailedCount,
        badUserForeignKeys: diagnostics.badConstraints.userForeignKeys.length
      });

      const repaired = await repairIntegrationSchema();
      if (needsRepair(repaired)) {
        throw new Error("Integration schema repair did not complete.");
      }
    }

    integrationSchemaReady = true;
  })().finally(() => {
    integrationSchemaPromise = null;
  });

  await integrationSchemaPromise;
}
