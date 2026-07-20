-- Voice Agents feature: feature key, integration type, and the VoiceCall table.

-- New enum labels (idempotent — enum values cannot be added inside a transaction
-- alongside their use, so they are added first and separately).
ALTER TYPE public."FeatureKey" ADD VALUE IF NOT EXISTS 'VOICE_AGENTS';
ALTER TYPE public."IntegrationType" ADD VALUE IF NOT EXISTS 'VOICE_AGENT';

-- Call direction + status enums.
DO $$
BEGIN
  CREATE TYPE public."VoiceCallDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public."VoiceCallStatus" AS ENUM (
    'QUEUED',
    'RINGING',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'NO_ANSWER',
    'BUSY',
    'CANCELED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public."VoiceCall" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "direction" public."VoiceCallDirection" NOT NULL,
  "status" public."VoiceCallStatus" NOT NULL DEFAULT 'QUEUED',
  "fromNumber" TEXT NOT NULL,
  "toNumber" TEXT NOT NULL,
  "contactId" TEXT,
  "language" TEXT,
  "providerCallId" TEXT,
  "recordingUrl" TEXT,
  "durationSec" INTEGER,
  "transcript" JSONB,
  "summary" TEXT,
  "errorMessage" TEXT,
  "createdById" TEXT,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VoiceCall_tenantId_createdAt_idx" ON public."VoiceCall"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "VoiceCall_tenantId_status_idx" ON public."VoiceCall"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "VoiceCall_providerCallId_idx" ON public."VoiceCall"("providerCallId");

ALTER TABLE public."VoiceCall"
  ADD CONSTRAINT "VoiceCall_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."VoiceCall"
  ADD CONSTRAINT "VoiceCall_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES public."Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS baseline (per DEPLOYMENT_SECURITY.md): enable RLS and revoke direct grants
-- so the table is only reachable through authenticated backend API routes.
ALTER TABLE public."VoiceCall" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."VoiceCall" FROM anon, authenticated;
