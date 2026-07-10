import { prisma } from "@/lib/prisma";

let sourceCampaignSchemaReady = false;
let sourceCampaignSchemaPromise: Promise<void> | null = null;

const statements = [
  `CREATE TABLE IF NOT EXISTS public."campaigns" (
    "id" TEXT PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceSheet" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS public."campaign_steps" (
    "id" TEXT PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "sendCondition" TEXT NOT NULL DEFAULT 'NO_INBOUND_REPLY_SINCE_START',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS public."campaign_enrollments" (
    "id" TEXT PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "sourceSheet" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextStepNumber" INTEGER,
    "nextSendAt" TIMESTAMP(3),
    "campaignStartTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundMessageAt" TIMESTAMP(3),
    "lastScheduledFor" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "lastDeliveryStatus" TEXT,
    "lastMessageId" TEXT,
    "lastWhatsAppMessageId" TEXT,
    "stepDeliveries" JSONB,
    "stoppedAt" TIMESTAMP(3),
    "stoppedReason" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `ALTER TABLE public."campaigns" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."campaigns" ADD COLUMN IF NOT EXISTS "key" TEXT;`,
  `ALTER TABLE public."campaigns" ADD COLUMN IF NOT EXISTS "name" TEXT;`,
  `ALTER TABLE public."campaigns" ADD COLUMN IF NOT EXISTS "sourceSheet" TEXT;`,
  `ALTER TABLE public."campaigns" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'ACTIVE';`,
  `ALTER TABLE public."campaigns" ADD COLUMN IF NOT EXISTS "metadata" JSONB;`,
  `ALTER TABLE public."campaigns" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."campaigns" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."campaign_steps" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;`,
  `ALTER TABLE public."campaign_steps" ADD COLUMN IF NOT EXISTS "stepNumber" INTEGER;`,
  `ALTER TABLE public."campaign_steps" ADD COLUMN IF NOT EXISTS "delayDays" INTEGER;`,
  `ALTER TABLE public."campaign_steps" ADD COLUMN IF NOT EXISTS "body" TEXT;`,
  `ALTER TABLE public."campaign_steps" ADD COLUMN IF NOT EXISTS "sendCondition" TEXT DEFAULT 'NO_INBOUND_REPLY_SINCE_START';`,
  `ALTER TABLE public."campaign_steps" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."campaign_steps" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "leadId" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "contactId" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "sourceSheet" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'ACTIVE';`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "currentStep" INTEGER DEFAULT 0;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "nextStepNumber" INTEGER;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "nextSendAt" TIMESTAMP(3);`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "campaignStartTime" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "lastInboundMessageAt" TIMESTAMP(3);`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "lastScheduledFor" TIMESTAMP(3);`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3);`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "lastDeliveryStatus" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "lastMessageId" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "lastWhatsAppMessageId" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "stepDeliveries" JSONB;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "stoppedAt" TIMESTAMP(3);`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "stoppedReason" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."campaign_enrollments" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_tenantId_key_key" ON public."campaigns"("tenantId", "key");`,
  `CREATE INDEX IF NOT EXISTS "campaigns_tenantId_status_idx" ON public."campaigns"("tenantId", "status");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "campaign_steps_campaignId_stepNumber_key" ON public."campaign_steps"("campaignId", "stepNumber");`,
  `CREATE INDEX IF NOT EXISTS "campaign_steps_campaignId_idx" ON public."campaign_steps"("campaignId");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "campaign_enrollments_campaignId_contactId_key" ON public."campaign_enrollments"("campaignId", "contactId");`,
  `CREATE INDEX IF NOT EXISTS "campaign_enrollments_tenantId_status_nextSendAt_idx" ON public."campaign_enrollments"("tenantId", "status", "nextSendAt");`,
  `CREATE INDEX IF NOT EXISTS "campaign_enrollments_tenantId_contactId_idx" ON public."campaign_enrollments"("tenantId", "contactId");`,
  `CREATE INDEX IF NOT EXISTS "campaign_enrollments_tenantId_conversationId_idx" ON public."campaign_enrollments"("tenantId", "conversationId");`,
  `CREATE INDEX IF NOT EXISTS "campaign_enrollments_campaignId_status_idx" ON public."campaign_enrollments"("campaignId", "status");`
];

export async function ensureSourceCampaignSchema() {
  if (sourceCampaignSchemaReady) return;

  sourceCampaignSchemaPromise ??= (async () => {
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
    sourceCampaignSchemaReady = true;
  })().finally(() => {
    sourceCampaignSchemaPromise = null;
  });

  await sourceCampaignSchemaPromise;
}
