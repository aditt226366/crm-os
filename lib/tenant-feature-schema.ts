import { prisma } from "@/lib/prisma";
import { FEATURE_KEYS, defaultEnabledFeatures, type Plan } from "@/lib/constants";

type ExistsRow = {
  exists: boolean;
};

let tenantFeatureSchemaReady = false;
let tenantFeatureSchemaPromise: Promise<void> | null = null;

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function tableExists(tableName: string) {
  const rows = await prisma.$queryRaw<ExistsRow[]>`
    SELECT to_regclass(${`public."${tableName}"`}) IS NOT NULL AS "exists";
  `;
  return Boolean(rows[0]?.exists);
}

async function tenantFeatureSchemaNeedsRepair() {
  const exists = await tableExists("TenantFeature");
  if (!exists) {
    return true;
  }

  const [columnRows, enumRows] = await Promise.all([
    prisma.$queryRaw<Array<{ columnName: string }>>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'TenantFeature';
    `,
    prisma.$queryRaw<Array<{ enumLabel: string }>>`
      SELECT e.enumlabel AS "enumLabel"
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'FeatureKey';
    `
  ]);

  const columns = new Set(columnRows.map((row) => row.columnName));
  const enumLabels = new Set(enumRows.map((row) => row.enumLabel));
  const requiredColumns = ["id", "tenantId", "featureKey", "enabled", "updatedById", "updatedAt", "createdAt"];

  return (
    requiredColumns.some((column) => !columns.has(column)) ||
    FEATURE_KEYS.some((featureKey) => !enumLabels.has(featureKey))
  );
}

const featureEnumValues = FEATURE_KEYS.map(sqlString).join(",\n    ");

const repairStatements = [
  `DO $$
BEGIN
  CREATE TYPE public."FeatureKey" AS ENUM (
    ${featureEnumValues}
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  ...FEATURE_KEYS.map((featureKey) => `ALTER TYPE public."FeatureKey" ADD VALUE IF NOT EXISTS ${sqlString(featureKey)};`),
  `CREATE TABLE IF NOT EXISTS public."TenantFeature" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "featureKey" public."FeatureKey" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."TenantFeature" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."TenantFeature" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."TenantFeature" ADD COLUMN IF NOT EXISTS "featureKey" public."FeatureKey";`,
  `ALTER TABLE public."TenantFeature" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN DEFAULT false;`,
  `ALTER TABLE public."TenantFeature" ADD COLUMN IF NOT EXISTS "updatedById" TEXT;`,
  `ALTER TABLE public."TenantFeature" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."TenantFeature" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `DELETE FROM public."TenantFeature" WHERE "tenantId" IS NULL OR "featureKey" IS NULL;`,
  `UPDATE public."TenantFeature"
SET "id" = CONCAT('feature_', md5(random()::TEXT || clock_timestamp()::TEXT))
WHERE "id" IS NULL;`,
  `UPDATE public."TenantFeature" SET "enabled" = false WHERE "enabled" IS NULL;`,
  `UPDATE public."TenantFeature" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `UPDATE public."TenantFeature" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `DELETE FROM public."TenantFeature" a
USING public."TenantFeature" b
WHERE a.ctid < b.ctid
AND a."tenantId" = b."tenantId"
AND a."featureKey" = b."featureKey";`,
  `ALTER TABLE public."TenantFeature" ALTER COLUMN "id" SET NOT NULL;`,
  `ALTER TABLE public."TenantFeature" ALTER COLUMN "tenantId" SET NOT NULL;`,
  `ALTER TABLE public."TenantFeature" ALTER COLUMN "featureKey" SET NOT NULL;`,
  `ALTER TABLE public."TenantFeature" ALTER COLUMN "enabled" SET NOT NULL;`,
  `ALTER TABLE public."TenantFeature" ALTER COLUMN "updatedAt" SET NOT NULL;`,
  `ALTER TABLE public."TenantFeature" ALTER COLUMN "createdAt" SET NOT NULL;`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TenantFeature_pkey'
  ) THEN
    ALTER TABLE public."TenantFeature"
    ADD CONSTRAINT "TenantFeature_pkey" PRIMARY KEY ("id");
  END IF;
END $$;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TenantFeature_tenantId_featureKey_key" ON public."TenantFeature"("tenantId", "featureKey");`,
  `CREATE INDEX IF NOT EXISTS "TenantFeature_featureKey_idx" ON public."TenantFeature"("featureKey");`
];

export async function repairTenantFeatureSchema() {
  for (const statement of repairStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  tenantFeatureSchemaReady = !(await tenantFeatureSchemaNeedsRepair());
}

export async function ensureTenantFeatureSchema() {
  if (tenantFeatureSchemaReady) return;

  tenantFeatureSchemaPromise ??= (async () => {
    if (await tenantFeatureSchemaNeedsRepair()) {
      console.warn("[features.schema] repairing TenantFeature schema");
      await repairTenantFeatureSchema();
    }

    tenantFeatureSchemaReady = true;
  })().finally(() => {
    tenantFeatureSchemaPromise = null;
  });

  await tenantFeatureSchemaPromise;
}

export async function ensureTenantFeatureRows(tenantId: string, plan: Plan, updatedById?: string | null) {
  await ensureTenantFeatureSchema();

  const enabled = defaultEnabledFeatures(plan);
  for (const featureKey of FEATURE_KEYS) {
    await prisma.tenantFeature.upsert({
      where: { tenantId_featureKey: { tenantId, featureKey } },
      create: {
        tenantId,
        featureKey,
        enabled: enabled.has(featureKey),
        updatedById: updatedById ?? undefined
      },
      update: {}
    });
  }
}
