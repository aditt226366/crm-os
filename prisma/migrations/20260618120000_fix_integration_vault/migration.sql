DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationType') THEN
    CREATE TYPE "IntegrationType" AS ENUM (
      'GOOGLE_SHEETS',
      'WHATSAPP_CLOUD',
      'WHATSAPP_TEMPLATE_SETTINGS',
      'META_ADS',
      'KNOWLEDGE_BASE',
      'AI_MODEL'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationStatus') THEN
    CREATE TYPE "IntegrationStatus" AS ENUM (
      'CONNECTED',
      'NOT_CONNECTED',
      'ERROR',
      'PARTIALLY_CONNECTED'
    );
  END IF;
END
$$;

ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'GOOGLE_SHEETS';
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'WHATSAPP_CLOUD';
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'WHATSAPP_TEMPLATE_SETTINGS';
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'META_ADS';
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'KNOWLEDGE_BASE';
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'AI_MODEL';

ALTER TYPE "IntegrationStatus" ADD VALUE IF NOT EXISTS 'CONNECTED';
ALTER TYPE "IntegrationStatus" ADD VALUE IF NOT EXISTS 'NOT_CONNECTED';
ALTER TYPE "IntegrationStatus" ADD VALUE IF NOT EXISTS 'ERROR';
ALTER TYPE "IntegrationStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_CONNECTED';

CREATE TABLE IF NOT EXISTS "Integration" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "IntegrationType" NOT NULL,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
  "encryptedConfig" TEXT,
  "maskedDisplay" JSONB,
  "metadata" JSONB,
  "lastVerifiedAt" TIMESTAMP(3),
  "lastVerificationError" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "type" "IntegrationType";
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "status" "IntegrationStatus" DEFAULT 'NOT_CONNECTED';
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "encryptedConfig" TEXT;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "maskedDisplay" JSONB;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "lastVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "lastVerificationError" TEXT;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "updatedById" TEXT;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

UPDATE "Integration" SET "id" = CONCAT('integration_', md5(random()::TEXT || clock_timestamp()::TEXT)) WHERE "id" IS NULL;
UPDATE "Integration" SET "status" = 'NOT_CONNECTED' WHERE "status" IS NULL;
UPDATE "Integration" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
UPDATE "Integration" SET "createdAt" = CURRENT_TIMESTAMP WHERE "createdAt" IS NULL;

ALTER TABLE "Integration" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Integration" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Integration" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "Integration" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Integration" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Integration" ALTER COLUMN "createdAt" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Integration_tenantId_fkey'
  ) THEN
    ALTER TABLE "Integration"
      ADD CONSTRAINT "Integration_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Integration_createdById_fkey'
  ) THEN
    ALTER TABLE "Integration"
      ADD CONSTRAINT "Integration_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Integration_updatedById_fkey'
  ) THEN
    ALTER TABLE "Integration"
      ADD CONSTRAINT "Integration_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "Integration_tenantId_type_key" ON "Integration"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "Integration_tenantId_idx" ON "Integration"("tenantId");
CREATE INDEX IF NOT EXISTS "Integration_type_idx" ON "Integration"("type");
CREATE INDEX IF NOT EXISTS "Integration_status_idx" ON "Integration"("status");
