CREATE TABLE IF NOT EXISTS public."campaigns" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourceSheet" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."campaign_steps" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "stepNumber" INTEGER NOT NULL,
  "delayDays" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  "sendCondition" TEXT NOT NULL DEFAULT 'NO_INBOUND_REPLY_SINCE_START',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaign_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."campaign_enrollments" (
  "id" TEXT NOT NULL,
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
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaign_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_tenantId_key_key" ON public."campaigns"("tenantId", "key");
CREATE INDEX IF NOT EXISTS "campaigns_tenantId_status_idx" ON public."campaigns"("tenantId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_steps_campaignId_stepNumber_key" ON public."campaign_steps"("campaignId", "stepNumber");
CREATE INDEX IF NOT EXISTS "campaign_steps_campaignId_idx" ON public."campaign_steps"("campaignId");

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_enrollments_campaignId_contactId_key" ON public."campaign_enrollments"("campaignId", "contactId");
CREATE INDEX IF NOT EXISTS "campaign_enrollments_tenantId_status_nextSendAt_idx" ON public."campaign_enrollments"("tenantId", "status", "nextSendAt");
CREATE INDEX IF NOT EXISTS "campaign_enrollments_tenantId_contactId_idx" ON public."campaign_enrollments"("tenantId", "contactId");
CREATE INDEX IF NOT EXISTS "campaign_enrollments_tenantId_conversationId_idx" ON public."campaign_enrollments"("tenantId", "conversationId");
CREATE INDEX IF NOT EXISTS "campaign_enrollments_campaignId_status_idx" ON public."campaign_enrollments"("campaignId", "status");

ALTER TABLE public."campaigns"
  ADD CONSTRAINT "campaigns_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."campaign_steps"
  ADD CONSTRAINT "campaign_steps_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES public."campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."campaign_enrollments"
  ADD CONSTRAINT "campaign_enrollments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."campaign_enrollments"
  ADD CONSTRAINT "campaign_enrollments_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES public."campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."campaign_enrollments"
  ADD CONSTRAINT "campaign_enrollments_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES public."Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public."campaign_enrollments"
  ADD CONSTRAINT "campaign_enrollments_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES public."Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."campaign_enrollments"
  ADD CONSTRAINT "campaign_enrollments_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES public."Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
