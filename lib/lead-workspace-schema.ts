import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FEATURE_KEYS } from "@/lib/constants";

type ExistsRow = {
  exists: boolean;
};

let leadWorkspaceSchemaReady = false;
let leadWorkspaceSchemaPromise: Promise<void> | null = null;

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function tableExists(tableName: string) {
  const rows = await prisma.$queryRaw<ExistsRow[]>`
    SELECT to_regclass(${`public."${tableName}"`}) IS NOT NULL AS "exists";
  `;
  return Boolean(rows[0]?.exists);
}

const enumDefinitions: Record<string, string[]> = {
  FeatureKey: [...FEATURE_KEYS],
  LeadTemperature: ["HOT", "WARM", "SCRAP"],
  LeadStatus: ["NEW", "CONTACTED", "QUALIFIED", "ORDER_INTENT", "WON", "LOST"],
  ConversationSource: ["BROADCAST", "CAMPAIGN", "AD", "ORGANIC", "GOOGLE_SHEET", "MANUAL"],
  ConversationStatus: ["OPEN", "PENDING", "RESOLVED"],
  MessageDirection: ["INBOUND", "OUTBOUND"],
  MessageType: ["TEXT", "TEMPLATE", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "SYSTEM", "NOTE"],
  MessageStatus: ["RECEIVED", "PENDING", "SENT", "DELIVERED", "READ", "FAILED"],
  OrderStatus: ["DRAFT", "CONFIRMED", "DISPATCHED", "COMPLETED", "CANCELLED"],
  HumanQueueStatus: ["OPEN", "ASSIGNED", "RESOLVED"],
  KnowledgeDocumentType: ["PDF", "DOCX", "TXT", "CSV", "FAQ", "URL"],
  KnowledgeDocumentStatus: ["UPLOADED", "PROCESSING", "INDEXED", "FAILED"],
  TemplateCategory: ["MARKETING", "UTILITY", "AUTHENTICATION"],
  TemplateStatus: ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"]
};

const requiredColumns: Record<string, string[]> = {
  Contact: [
    "id",
    "tenantId",
    "name",
    "phone",
    "email",
    "optIn",
    "optOut",
    "source",
    "tags",
    "customFields",
    "leadTemperature",
    "leadTemperatureOverride",
    "leadTemperatureOverrideReason",
    "customerReplyCount",
    "totalMessageCount",
    "lastMessageAt",
    "lastContactedAt",
    "createdAt",
    "updatedAt"
  ],
  Conversation: [
    "id",
    "tenantId",
    "contactId",
    "assignedUserId",
    "source",
    "sourceId",
    "status",
    "unreadCount",
    "humanTakeover",
    "humanQueueId",
    "customerReplyCount",
    "totalMessageCount",
    "lastMessageText",
    "lastMessageAt",
    "customerServiceWindowExpiresAt",
    "createdAt",
    "updatedAt"
  ],
  Message: [
    "id",
    "tenantId",
    "conversationId",
    "contactId",
    "direction",
    "type",
    "body",
    "templateId",
    "whatsappMessageId",
    "status",
    "failureReason",
    "metadata",
    "createdAt",
    "updatedAt"
  ],
  Lead: [
    "id",
    "tenantId",
    "contactId",
    "conversationId",
    "source",
    "temperature",
    "status",
    "score",
    "productInterest",
    "location",
    "assignedUserId",
    "createdAt",
    "updatedAt"
  ],
  WhatsAppTemplate: [
    "id",
    "tenantId",
    "metaTemplateId",
    "name",
    "category",
    "language",
    "status",
    "body",
    "variables",
    "components",
    "createdAt",
    "updatedAt"
  ],
  ApiUsageLog: [
    "id",
    "tenantId",
    "featureKey",
    "provider",
    "eventType",
    "endpoint",
    "units",
    "cost",
    "status",
    "metadata",
    "createdAt"
  ],
  Order: [
    "id",
    "tenantId",
    "contactId",
    "conversationId",
    "orderNumber",
    "products",
    "quantity",
    "location",
    "notes",
    "status",
    "extractedByAI",
    "confidence",
    "source",
    "assignedUserId",
    "createdAt",
    "updatedAt"
  ],
  HumanQueueItem: [
    "id",
    "tenantId",
    "conversationId",
    "contactId",
    "assignedUserId",
    "reason",
    "priority",
    "status",
    "slaDueAt",
    "createdAt",
    "resolvedAt"
  ],
  KnowledgeDocument: [
    "id",
    "tenantId",
    "title",
    "type",
    "status",
    "storageKey",
    "metadata",
    "createdById",
    "createdAt",
    "updatedAt"
  ],
  KnowledgeChunk: ["id", "tenantId", "documentId", "content", "embedding", "metadata", "createdAt"]
};

async function leadWorkspaceSchemaNeedsRepair() {
  const tableNames = Object.keys(requiredColumns);
  for (const tableName of tableNames) {
    if (!(await tableExists(tableName))) {
      return true;
    }
  }

  const columnRows = await prisma.$queryRaw<
    Array<{ tableName: string; columnName: string; isNullable: string; dataType: string; udtName: string }>
  >`
    SELECT
      table_name AS "tableName",
      column_name AS "columnName",
      is_nullable AS "isNullable",
      data_type AS "dataType",
      udt_name AS "udtName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name IN (${Prisma.join(tableNames)});
  `;
  const enumRows = await prisma.$queryRaw<Array<{ enumName: string; enumLabel: string }>>`
    SELECT t.typname AS "enumName", e.enumlabel AS "enumLabel"
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname IN (${Prisma.join(Object.keys(enumDefinitions))});
  `;

  const requiredLegacyColumns = new Set(
    columnRows.filter((row) => row.isNullable === "NO").map((row) => `${row.tableName}.${row.columnName}`)
  );
  const legacyColumnsThatBlockCurrentWrites = [
    "Lead.name",
    "Lead.phone",
    "Lead.companyId",
    "Message.leadId",
    "Message.content"
  ];
  if (legacyColumnsThatBlockCurrentWrites.some((column) => requiredLegacyColumns.has(column))) {
    return true;
  }

  const apiUsageProvider = columnRows.find(
    (row) => row.tableName === "ApiUsageLog" && row.columnName === "provider"
  );
  if (apiUsageProvider && apiUsageProvider.udtName !== "text") {
    return true;
  }

  const columns = new Set(columnRows.map((row) => `${row.tableName}.${row.columnName}`));
  const enumLabels = new Set(enumRows.map((row) => `${row.enumName}.${row.enumLabel}`));

  return (
    Object.entries(requiredColumns).some(([tableName, columnsForTable]) =>
      columnsForTable.some((columnName) => !columns.has(`${tableName}.${columnName}`))
    ) ||
    Object.entries(enumDefinitions).some(([enumName, values]) =>
      values.some((value) => !enumLabels.has(`${enumName}.${value}`))
    )
  );
}

const enumRepairStatements = Object.entries(enumDefinitions).flatMap(([enumName, values]) => [
  `DO $$
BEGIN
  CREATE TYPE public."${enumName}" AS ENUM (
    ${values.map(sqlString).join(",\n    ")}
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  ...values.map((value) => `ALTER TYPE public."${enumName}" ADD VALUE IF NOT EXISTS ${sqlString(value)};`)
]);

const tableRepairStatements = [
  `CREATE TABLE IF NOT EXISTS public."Contact" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "optIn" BOOLEAN NOT NULL DEFAULT true,
  "optOut" BOOLEAN NOT NULL DEFAULT false,
  "source" public."ConversationSource" NOT NULL DEFAULT 'ORGANIC',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "customFields" JSONB,
  "leadTemperature" public."LeadTemperature" NOT NULL DEFAULT 'SCRAP',
  "leadTemperatureOverride" public."LeadTemperature",
  "leadTemperatureOverrideReason" TEXT,
  "customerReplyCount" INTEGER NOT NULL DEFAULT 0,
  "totalMessageCount" INTEGER NOT NULL DEFAULT 0,
  "lastMessageAt" TIMESTAMP(3),
  "lastContactedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "name" TEXT;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "phone" TEXT;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "email" TEXT;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "optIn" BOOLEAN DEFAULT true;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "optOut" BOOLEAN DEFAULT false;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "source" public."ConversationSource" DEFAULT 'ORGANIC';`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "customFields" JSONB;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "leadTemperature" public."LeadTemperature" DEFAULT 'SCRAP';`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "leadTemperatureOverride" public."LeadTemperature";`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "leadTemperatureOverrideReason" TEXT;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "customerReplyCount" INTEGER DEFAULT 0;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "totalMessageCount" INTEGER DEFAULT 0;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3);`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "lastContactedAt" TIMESTAMP(3);`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."Contact" SET "name" = COALESCE("name", "phone", 'Unknown contact') WHERE "name" IS NULL;`,
  `UPDATE public."Contact" SET "phone" = COALESCE("phone", "id") WHERE "phone" IS NULL;`,
  `UPDATE public."Contact" SET "optIn" = true WHERE "optIn" IS NULL;`,
  `UPDATE public."Contact" SET "optOut" = false WHERE "optOut" IS NULL;`,
  `UPDATE public."Contact" SET "source" = 'ORGANIC'::public."ConversationSource" WHERE "source" IS NULL;`,
  `UPDATE public."Contact" SET "tags" = ARRAY[]::TEXT[] WHERE "tags" IS NULL;`,
  `UPDATE public."Contact" SET "leadTemperature" = 'SCRAP'::public."LeadTemperature" WHERE "leadTemperature" IS NULL;`,
  `UPDATE public."Contact" SET "customerReplyCount" = 0 WHERE "customerReplyCount" IS NULL;`,
  `UPDATE public."Contact" SET "totalMessageCount" = 0 WHERE "totalMessageCount" IS NULL;`,
  `UPDATE public."Contact" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."Contact" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Contact_tenantId_phone_key" ON public."Contact"("tenantId", "phone");`,
  `CREATE INDEX IF NOT EXISTS "Contact_tenantId_leadTemperature_idx" ON public."Contact"("tenantId", "leadTemperature");`,
  `CREATE INDEX IF NOT EXISTS "Contact_tenantId_source_idx" ON public."Contact"("tenantId", "source");`,
  `CREATE INDEX IF NOT EXISTS "Contact_lastMessageAt_idx" ON public."Contact"("lastMessageAt");`,

  `CREATE TABLE IF NOT EXISTS public."Conversation" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "assignedUserId" TEXT,
  "source" public."ConversationSource" NOT NULL DEFAULT 'ORGANIC',
  "sourceId" TEXT,
  "status" public."ConversationStatus" NOT NULL DEFAULT 'OPEN',
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "humanTakeover" BOOLEAN NOT NULL DEFAULT false,
  "humanQueueId" TEXT,
  "customerReplyCount" INTEGER NOT NULL DEFAULT 0,
  "totalMessageCount" INTEGER NOT NULL DEFAULT 0,
  "lastMessageText" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "customerServiceWindowExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "contactId" TEXT;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "source" public."ConversationSource" DEFAULT 'ORGANIC';`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "status" public."ConversationStatus" DEFAULT 'OPEN';`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "unreadCount" INTEGER DEFAULT 0;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "humanTakeover" BOOLEAN DEFAULT false;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "humanQueueId" TEXT;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "customerReplyCount" INTEGER DEFAULT 0;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "totalMessageCount" INTEGER DEFAULT 0;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "lastMessageText" TEXT;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3);`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "customerServiceWindowExpiresAt" TIMESTAMP(3);`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."Conversation" SET "source" = 'ORGANIC'::public."ConversationSource" WHERE "source" IS NULL;`,
  `UPDATE public."Conversation" SET "status" = 'OPEN'::public."ConversationStatus" WHERE "status" IS NULL;`,
  `UPDATE public."Conversation" SET "unreadCount" = 0 WHERE "unreadCount" IS NULL;`,
  `UPDATE public."Conversation" SET "humanTakeover" = false WHERE "humanTakeover" IS NULL;`,
  `UPDATE public."Conversation" SET "customerReplyCount" = 0 WHERE "customerReplyCount" IS NULL;`,
  `UPDATE public."Conversation" SET "totalMessageCount" = 0 WHERE "totalMessageCount" IS NULL;`,
  `UPDATE public."Conversation" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."Conversation" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "Conversation_tenantId_lastMessageAt_idx" ON public."Conversation"("tenantId", "lastMessageAt");`,
  `CREATE INDEX IF NOT EXISTS "Conversation_tenantId_status_idx" ON public."Conversation"("tenantId", "status");`,
  `CREATE INDEX IF NOT EXISTS "Conversation_tenantId_source_idx" ON public."Conversation"("tenantId", "source");`,
  `CREATE INDEX IF NOT EXISTS "Conversation_tenantId_contactId_idx" ON public."Conversation"("tenantId", "contactId");`,

  `CREATE TABLE IF NOT EXISTS public."Message" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "direction" public."MessageDirection" NOT NULL,
  "type" public."MessageType" NOT NULL DEFAULT 'TEXT',
  "body" TEXT NOT NULL,
  "templateId" TEXT,
  "whatsappMessageId" TEXT,
  "status" public."MessageStatus" NOT NULL DEFAULT 'PENDING',
  "failureReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "contactId" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "direction" public."MessageDirection";`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "type" public."MessageType" DEFAULT 'TEXT';`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "body" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "templateId" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "whatsappMessageId" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "status" public."MessageStatus" DEFAULT 'PENDING';`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "metadata" JSONB;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Message" ALTER COLUMN "leadId" DROP NOT NULL;`,
  `ALTER TABLE public."Message" ALTER COLUMN "content" DROP NOT NULL;`,
  `UPDATE public."Message" SET "type" = 'TEXT'::public."MessageType" WHERE "type" IS NULL;`,
  `UPDATE public."Message" SET "status" = 'PENDING'::public."MessageStatus" WHERE "status" IS NULL;`,
  `UPDATE public."Message" SET "body" = '' WHERE "body" IS NULL;`,
  `UPDATE public."Message" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."Message" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Message_tenantId_whatsappMessageId_key" ON public."Message"("tenantId", "whatsappMessageId") WHERE "whatsappMessageId" IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS "Message_tenantId_conversationId_createdAt_idx" ON public."Message"("tenantId", "conversationId", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "Message_tenantId_direction_createdAt_idx" ON public."Message"("tenantId", "direction", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "Message_status_idx" ON public."Message"("status");`,

  `CREATE TABLE IF NOT EXISTS public."Lead" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "source" public."ConversationSource" NOT NULL DEFAULT 'ORGANIC',
  "temperature" public."LeadTemperature" NOT NULL DEFAULT 'SCRAP',
  "status" public."LeadStatus" NOT NULL DEFAULT 'NEW',
  "score" INTEGER NOT NULL DEFAULT 0,
  "productInterest" TEXT,
  "location" TEXT,
  "assignedUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "contactId" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "source" public."ConversationSource" DEFAULT 'ORGANIC';`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "temperature" public."LeadTemperature" DEFAULT 'SCRAP';`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "status" public."LeadStatus" DEFAULT 'NEW';`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "score" INTEGER DEFAULT 0;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "productInterest" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "location" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Lead" ALTER COLUMN "name" DROP NOT NULL;`,
  `ALTER TABLE public."Lead" ALTER COLUMN "phone" DROP NOT NULL;`,
  `ALTER TABLE public."Lead" ALTER COLUMN "companyId" DROP NOT NULL;`,
  `ALTER TABLE public."Lead" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."Lead" SET "source" = 'ORGANIC'::public."ConversationSource" WHERE "source" IS NULL;`,
  `UPDATE public."Lead" SET "temperature" = 'SCRAP'::public."LeadTemperature" WHERE "temperature" IS NULL;`,
  `UPDATE public."Lead" SET "status" = 'NEW'::public."LeadStatus" WHERE "status" IS NULL;`,
  `UPDATE public."Lead" SET "score" = 0 WHERE "score" IS NULL;`,
  `UPDATE public."Lead" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."Lead" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "Lead_tenantId_temperature_idx" ON public."Lead"("tenantId", "temperature");`,
  `CREATE INDEX IF NOT EXISTS "Lead_tenantId_source_idx" ON public."Lead"("tenantId", "source");`,
  `CREATE INDEX IF NOT EXISTS "Lead_tenantId_status_idx" ON public."Lead"("tenantId", "status");`,
  `CREATE INDEX IF NOT EXISTS "Lead_tenantId_contactId_idx" ON public."Lead"("tenantId", "contactId");`,

  `CREATE TABLE IF NOT EXISTS public."WhatsAppTemplate" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "metaTemplateId" TEXT,
  "name" TEXT NOT NULL,
  "category" public."TemplateCategory" NOT NULL,
  "language" TEXT NOT NULL,
  "status" public."TemplateStatus" NOT NULL DEFAULT 'PENDING',
  "body" TEXT NOT NULL,
  "variables" JSONB,
  "components" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "metaTemplateId" TEXT;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "name" TEXT;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "category" public."TemplateCategory" DEFAULT 'MARKETING';`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "language" TEXT;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "status" public."TemplateStatus" DEFAULT 'PENDING';`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "body" TEXT;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "variables" JSONB;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "components" JSONB;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."WhatsAppTemplate" SET "category" = 'MARKETING'::public."TemplateCategory" WHERE "category" IS NULL;`,
  `UPDATE public."WhatsAppTemplate" SET "status" = 'PENDING'::public."TemplateStatus" WHERE "status" IS NULL;`,
  `UPDATE public."WhatsAppTemplate" SET "body" = COALESCE("body", CONCAT('Approved WhatsApp template: ', "name")) WHERE "body" IS NULL;`,
  `UPDATE public."WhatsAppTemplate" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."WhatsAppTemplate" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppTemplate_tenantId_name_language_key" ON public."WhatsAppTemplate"("tenantId", "name", "language");`,
  `CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_tenantId_status_idx" ON public."WhatsAppTemplate"("tenantId", "status");`,

  `CREATE TABLE IF NOT EXISTS public."ApiUsageLog" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "featureKey" public."FeatureKey" NOT NULL,
  "provider" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "endpoint" TEXT,
  "units" INTEGER NOT NULL DEFAULT 1,
  "cost" NUMERIC(12, 6) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "featureKey" public."FeatureKey";`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "provider" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "eventType" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "units" INTEGER DEFAULT 1;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "cost" NUMERIC(12, 6) DEFAULT 0;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "status" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "metadata" JSONB;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."ApiUsageLog" ALTER COLUMN "provider" TYPE TEXT USING "provider"::TEXT;`,
  `UPDATE public."ApiUsageLog" SET "units" = 1 WHERE "units" IS NULL;`,
  `UPDATE public."ApiUsageLog" SET "cost" = 0 WHERE "cost" IS NULL;`,
  `UPDATE public."ApiUsageLog" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "ApiUsageLog_tenantId_createdAt_idx" ON public."ApiUsageLog"("tenantId", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "ApiUsageLog_featureKey_createdAt_idx" ON public."ApiUsageLog"("featureKey", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "ApiUsageLog_provider_createdAt_idx" ON public."ApiUsageLog"("provider", "createdAt");`,

  `CREATE TABLE IF NOT EXISTS public."Order" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "orderNumber" TEXT NOT NULL,
  "products" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "quantity" INTEGER,
  "location" TEXT,
  "notes" TEXT,
  "status" public."OrderStatus" NOT NULL DEFAULT 'DRAFT',
  "extractedByAI" BOOLEAN NOT NULL DEFAULT false,
  "confidence" DOUBLE PRECISION,
  "source" public."ConversationSource" NOT NULL DEFAULT 'ORGANIC',
  "assignedUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "contactId" TEXT;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "orderNumber" TEXT;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "products" JSONB DEFAULT '[]'::jsonb;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "quantity" INTEGER;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "location" TEXT;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "notes" TEXT;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "status" public."OrderStatus" DEFAULT 'DRAFT';`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "extractedByAI" BOOLEAN DEFAULT false;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "source" public."ConversationSource" DEFAULT 'ORGANIC';`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."Order" SET "products" = '[]'::jsonb WHERE "products" IS NULL;`,
  `UPDATE public."Order" SET "status" = 'DRAFT'::public."OrderStatus" WHERE "status" IS NULL;`,
  `UPDATE public."Order" SET "extractedByAI" = false WHERE "extractedByAI" IS NULL;`,
  `UPDATE public."Order" SET "source" = 'ORGANIC'::public."ConversationSource" WHERE "source" IS NULL;`,
  `UPDATE public."Order" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."Order" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Order_tenantId_orderNumber_key" ON public."Order"("tenantId", "orderNumber");`,
  `CREATE INDEX IF NOT EXISTS "Order_tenantId_status_idx" ON public."Order"("tenantId", "status");`,
  `CREATE INDEX IF NOT EXISTS "Order_tenantId_createdAt_idx" ON public."Order"("tenantId", "createdAt");`,

  `CREATE TABLE IF NOT EXISTS public."HumanQueueItem" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "assignedUserId" TEXT,
  "reason" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "status" public."HumanQueueStatus" NOT NULL DEFAULT 'OPEN',
  "slaDueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3)
);`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "contactId" TEXT;`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "reason" TEXT;`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "priority" INTEGER DEFAULT 0;`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "status" public."HumanQueueStatus" DEFAULT 'OPEN';`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "slaDueAt" TIMESTAMP(3);`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."HumanQueueItem" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);`,
  `UPDATE public."HumanQueueItem" SET "reason" = 'Manual human takeover' WHERE "reason" IS NULL;`,
  `UPDATE public."HumanQueueItem" SET "priority" = 0 WHERE "priority" IS NULL;`,
  `UPDATE public."HumanQueueItem" SET "status" = 'OPEN'::public."HumanQueueStatus" WHERE "status" IS NULL;`,
  `UPDATE public."HumanQueueItem" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "HumanQueueItem_tenantId_status_priority_idx" ON public."HumanQueueItem"("tenantId", "status", "priority");`,
  `CREATE INDEX IF NOT EXISTS "HumanQueueItem_tenantId_conversationId_idx" ON public."HumanQueueItem"("tenantId", "conversationId");`,

  `CREATE TABLE IF NOT EXISTS public."KnowledgeDocument" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" public."KnowledgeDocumentType" NOT NULL,
  "status" public."KnowledgeDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  "storageKey" TEXT,
  "metadata" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "title" TEXT;`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "type" public."KnowledgeDocumentType";`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "status" public."KnowledgeDocumentStatus" DEFAULT 'UPLOADED';`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "metadata" JSONB;`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "createdById" TEXT;`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."KnowledgeDocument" SET "status" = 'UPLOADED'::public."KnowledgeDocumentStatus" WHERE "status" IS NULL;`,
  `UPDATE public."KnowledgeDocument" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."KnowledgeDocument" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "KnowledgeDocument_tenantId_status_idx" ON public."KnowledgeDocument"("tenantId", "status");`,
  `CREATE INDEX IF NOT EXISTS "KnowledgeDocument_tenantId_createdAt_idx" ON public."KnowledgeDocument"("tenantId", "createdAt");`,

  `CREATE TABLE IF NOT EXISTS public."KnowledgeChunk" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."KnowledgeChunk" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."KnowledgeChunk" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."KnowledgeChunk" ADD COLUMN IF NOT EXISTS "documentId" TEXT;`,
  `ALTER TABLE public."KnowledgeChunk" ADD COLUMN IF NOT EXISTS "content" TEXT;`,
  `ALTER TABLE public."KnowledgeChunk" ADD COLUMN IF NOT EXISTS "embedding" JSONB;`,
  `ALTER TABLE public."KnowledgeChunk" ADD COLUMN IF NOT EXISTS "metadata" JSONB;`,
  `ALTER TABLE public."KnowledgeChunk" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."KnowledgeChunk" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "KnowledgeChunk_tenantId_documentId_idx" ON public."KnowledgeChunk"("tenantId", "documentId");`
];

const repairStatements = [...enumRepairStatements, ...tableRepairStatements];

export async function repairLeadWorkspaceSchema() {
  for (const statement of repairStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  leadWorkspaceSchemaReady = !(await leadWorkspaceSchemaNeedsRepair());
}

export async function ensureLeadWorkspaceSchema() {
  if (leadWorkspaceSchemaReady) return;

  leadWorkspaceSchemaPromise ??= (async () => {
    if (await leadWorkspaceSchemaNeedsRepair()) {
      console.warn("[lead.workspace.schema] repairing lead workspace tables");
      await repairLeadWorkspaceSchema();
    }

    leadWorkspaceSchemaReady = true;
  })().finally(() => {
    leadWorkspaceSchemaPromise = null;
  });

  await leadWorkspaceSchemaPromise;
}
