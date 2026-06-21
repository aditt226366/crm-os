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
  BroadcastStatus: ["DRAFT", "SCHEDULED", "SENDING", "COMPLETED", "FAILED", "PAUSED", "CANCELLED"],
  BroadcastRecipientStatus: ["QUEUED", "SENT", "DELIVERED", "READ", "REPLIED", "FAILED", "SKIPPED"],
  CampaignStatus: ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"],
  CampaignRecipientStatus: ["QUEUED", "SENT", "DELIVERED", "READ", "REPLIED", "CLICKED", "CONVERTED", "FAILED", "SKIPPED"],
  AdCampaignStatus: ["DRAFT", "READY_TO_PUBLISH", "PENDING_APPROVAL", "RUNNING", "PAUSED", "COMPLETED", "REJECTED", "FAILED"],
  WorkflowStatus: ["DRAFT", "ACTIVE", "INACTIVE"],
  WorkflowRunStatus: ["RUNNING", "COMPLETED", "FAILED"],
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
  Broadcast: [
    "id",
    "tenantId",
    "name",
    "status",
    "templateId",
    "scheduledAt",
    "launchedAt",
    "completedAt",
    "createdById",
    "stats",
    "createdAt",
    "updatedAt"
  ],
  BroadcastRecipient: [
    "id",
    "tenantId",
    "broadcastId",
    "contactId",
    "conversationId",
    "messageId",
    "status",
    "error",
    "sentAt",
    "deliveredAt",
    "readAt",
    "repliedAt",
    "createdAt"
  ],
  Campaign: [
    "id",
    "tenantId",
    "name",
    "goal",
    "status",
    "templateId",
    "audienceType",
    "scheduleConfig",
    "retargetRules",
    "stats",
    "createdById",
    "createdAt",
    "updatedAt"
  ],
  CampaignRecipient: [
    "id",
    "tenantId",
    "campaignId",
    "contactId",
    "conversationId",
    "messageId",
    "status",
    "clicked",
    "replied",
    "converted",
    "metadata",
    "createdAt",
    "updatedAt"
  ],
  AdCampaign: [
    "id",
    "tenantId",
    "name",
    "objective",
    "platform",
    "status",
    "budget",
    "startDate",
    "endDate",
    "audienceConfig",
    "creativeConfig",
    "automationConfig",
    "metaCampaignId",
    "metaAdSetId",
    "metaAdId",
    "stats",
    "createdById",
    "createdAt",
    "updatedAt"
  ],
  Workflow: [
    "id",
    "tenantId",
    "name",
    "description",
    "status",
    "graphJson",
    "version",
    "createdById",
    "createdAt",
    "updatedAt"
  ],
  WorkflowRun: [
    "id",
    "tenantId",
    "workflowId",
    "conversationId",
    "contactId",
    "status",
    "startedAt",
    "completedAt",
    "error"
  ],
  WorkflowRunStep: [
    "id",
    "tenantId",
    "workflowRunId",
    "nodeId",
    "nodeType",
    "status",
    "input",
    "output",
    "error",
    "createdAt"
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

const expectedEnumColumns: Record<string, Record<string, string>> = {
  Contact: {
    source: "ConversationSource",
    leadTemperature: "LeadTemperature"
  },
  Conversation: {
    source: "ConversationSource",
    status: "ConversationStatus"
  },
  Message: {
    direction: "MessageDirection",
    type: "MessageType",
    status: "MessageStatus"
  },
  Lead: {
    source: "ConversationSource",
    temperature: "LeadTemperature",
    status: "LeadStatus"
  },
  WhatsAppTemplate: {
    category: "TemplateCategory",
    status: "TemplateStatus"
  },
  Broadcast: {
    status: "BroadcastStatus"
  },
  BroadcastRecipient: {
    status: "BroadcastRecipientStatus"
  },
  Campaign: {
    status: "CampaignStatus"
  },
  CampaignRecipient: {
    status: "CampaignRecipientStatus"
  },
  AdCampaign: {
    status: "AdCampaignStatus"
  },
  Workflow: {
    status: "WorkflowStatus"
  },
  WorkflowRun: {
    status: "WorkflowRunStatus"
  },
  WorkflowRunStep: {
    status: "WorkflowRunStatus"
  },
  ApiUsageLog: {
    featureKey: "FeatureKey"
  },
  Order: {
    status: "OrderStatus",
    source: "ConversationSource"
  },
  HumanQueueItem: {
    status: "HumanQueueStatus"
  },
  KnowledgeDocument: {
    type: "KnowledgeDocumentType",
    status: "KnowledgeDocumentStatus"
  }
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
    "Message.content",
    "ApiUsageLog.companyId",
    "ApiUsageLog.endpoint",
    "ApiUsageLog.method",
    "ApiUsageLog.statusCode",
    "ApiUsageLog.success",
    "ApiUsageLog.requestUnits",
    "ApiUsageLog.metadata"
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

  const columnByName = new Map(columnRows.map((row) => [`${row.tableName}.${row.columnName}`, row]));
  const hasWrongEnumColumn = Object.entries(expectedEnumColumns).some(([tableName, columnTypes]) =>
    Object.entries(columnTypes).some(([columnName, enumName]) => {
      const column = columnByName.get(`${tableName}.${columnName}`);
      return column && column.udtName !== enumName;
    })
  );
  if (hasWrongEnumColumn) {
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

function dropNotNullIfColumnExists(tableName: string, columnName: string) {
  return `DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${sqlString(tableName)}
      AND column_name = ${sqlString(columnName)}
  ) THEN
    ALTER TABLE public."${tableName}" ALTER COLUMN "${columnName}" DROP NOT NULL;
  END IF;
END $$;`;
}

function normalizeEnumColumn(tableName: string, columnName: string, enumName: string, fallbackValue: string) {
  const values = enumDefinitions[enumName] ?? [fallbackValue];
  return `DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${sqlString(tableName)}
      AND column_name = ${sqlString(columnName)}
  ) THEN
    ALTER TABLE public."${tableName}" ALTER COLUMN "${columnName}" DROP DEFAULT;
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${sqlString(tableName)}
        AND column_name = ${sqlString(columnName)}
        AND udt_name <> ${sqlString(enumName)}
    ) THEN
      ALTER TABLE public."${tableName}"
      ALTER COLUMN "${columnName}" TYPE public."${enumName}"
      USING CASE
        WHEN "${columnName}" IS NULL THEN ${sqlString(fallbackValue)}::public."${enumName}"
${values.map((value) => `        WHEN "${columnName}"::TEXT = ${sqlString(value)} THEN ${sqlString(value)}::public."${enumName}"`).join("\n")}
        ELSE ${sqlString(fallbackValue)}::public."${enumName}"
      END;
    END IF;
    ALTER TABLE public."${tableName}" ALTER COLUMN "${columnName}" SET DEFAULT ${sqlString(fallbackValue)}::public."${enumName}";
  END IF;
END $$;`;
}

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
  normalizeEnumColumn("Contact", "source", "ConversationSource", "ORGANIC"),
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "customFields" JSONB;`,
  `ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "leadTemperature" public."LeadTemperature" DEFAULT 'SCRAP';`,
  normalizeEnumColumn("Contact", "leadTemperature", "LeadTemperature", "SCRAP"),
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
  normalizeEnumColumn("Conversation", "source", "ConversationSource", "ORGANIC"),
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;`,
  `ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "status" public."ConversationStatus" DEFAULT 'OPEN';`,
  normalizeEnumColumn("Conversation", "status", "ConversationStatus", "OPEN"),
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
  normalizeEnumColumn("Message", "direction", "MessageDirection", "OUTBOUND"),
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "type" public."MessageType" DEFAULT 'TEXT';`,
  normalizeEnumColumn("Message", "type", "MessageType", "TEXT"),
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "body" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "templateId" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "whatsappMessageId" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "status" public."MessageStatus" DEFAULT 'PENDING';`,
  normalizeEnumColumn("Message", "status", "MessageStatus", "PENDING"),
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "metadata" JSONB;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Message" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  dropNotNullIfColumnExists("Message", "leadId"),
  dropNotNullIfColumnExists("Message", "content"),
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
  normalizeEnumColumn("Lead", "source", "ConversationSource", "ORGANIC"),
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "temperature" public."LeadTemperature" DEFAULT 'SCRAP';`,
  normalizeEnumColumn("Lead", "temperature", "LeadTemperature", "SCRAP"),
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "status" public."LeadStatus" DEFAULT 'NEW';`,
  normalizeEnumColumn("Lead", "status", "LeadStatus", "NEW"),
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "score" INTEGER DEFAULT 0;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "productInterest" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "location" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Lead" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  dropNotNullIfColumnExists("Lead", "name"),
  dropNotNullIfColumnExists("Lead", "phone"),
  dropNotNullIfColumnExists("Lead", "companyId"),
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
  normalizeEnumColumn("WhatsAppTemplate", "category", "TemplateCategory", "MARKETING"),
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "language" TEXT;`,
  `ALTER TABLE public."WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "status" public."TemplateStatus" DEFAULT 'PENDING';`,
  normalizeEnumColumn("WhatsAppTemplate", "status", "TemplateStatus", "PENDING"),
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

  `CREATE TABLE IF NOT EXISTS public."Broadcast" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" public."BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
  "templateId" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "launchedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "stats" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "name" TEXT;`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "status" public."BroadcastStatus" DEFAULT 'DRAFT';`,
  normalizeEnumColumn("Broadcast", "status", "BroadcastStatus", "DRAFT"),
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "templateId" TEXT;`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "launchedAt" TIMESTAMP(3);`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "createdById" TEXT;`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "stats" JSONB;`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Broadcast" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."Broadcast" SET "name" = COALESCE("name", CONCAT('Broadcast ', "id")) WHERE "name" IS NULL;`,
  `UPDATE public."Broadcast" SET "status" = 'DRAFT'::public."BroadcastStatus" WHERE "status" IS NULL;`,
  `UPDATE public."Broadcast" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."Broadcast" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "Broadcast_tenantId_status_idx" ON public."Broadcast"("tenantId", "status");`,
  `CREATE INDEX IF NOT EXISTS "Broadcast_tenantId_createdAt_idx" ON public."Broadcast"("tenantId", "createdAt");`,

  `CREATE TABLE IF NOT EXISTS public."BroadcastRecipient" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "broadcastId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "messageId" TEXT,
  "status" public."BroadcastRecipientStatus" NOT NULL DEFAULT 'QUEUED',
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "repliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "broadcastId" TEXT;`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "contactId" TEXT;`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "messageId" TEXT;`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "status" public."BroadcastRecipientStatus" DEFAULT 'QUEUED';`,
  normalizeEnumColumn("BroadcastRecipient", "status", "BroadcastRecipientStatus", "QUEUED"),
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "error" TEXT;`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "repliedAt" TIMESTAMP(3);`,
  `ALTER TABLE public."BroadcastRecipient" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."BroadcastRecipient" SET "status" = 'QUEUED'::public."BroadcastRecipientStatus" WHERE "status" IS NULL;`,
  `UPDATE public."BroadcastRecipient" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "BroadcastRecipient_tenantId_broadcastId_idx" ON public."BroadcastRecipient"("tenantId", "broadcastId");`,
  `CREATE INDEX IF NOT EXISTS "BroadcastRecipient_tenantId_status_idx" ON public."BroadcastRecipient"("tenantId", "status");`,

  `CREATE TABLE IF NOT EXISTS public."Campaign" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "status" public."CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "templateId" TEXT,
  "audienceType" TEXT,
  "scheduleConfig" JSONB,
  "retargetRules" JSONB,
  "stats" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "name" TEXT;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "goal" TEXT;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "status" public."CampaignStatus" DEFAULT 'DRAFT';`,
  normalizeEnumColumn("Campaign", "status", "CampaignStatus", "DRAFT"),
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "templateId" TEXT;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "audienceType" TEXT;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "scheduleConfig" JSONB;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "retargetRules" JSONB;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "stats" JSONB;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "createdById" TEXT;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."Campaign" SET "name" = COALESCE("name", CONCAT('Campaign ', "id")) WHERE "name" IS NULL;`,
  `UPDATE public."Campaign" SET "goal" = COALESCE("goal", 'Lead Nurturing') WHERE "goal" IS NULL;`,
  `UPDATE public."Campaign" SET "status" = 'DRAFT'::public."CampaignStatus" WHERE "status" IS NULL;`,
  `UPDATE public."Campaign" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."Campaign" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "Campaign_tenantId_status_idx" ON public."Campaign"("tenantId", "status");`,
  `CREATE INDEX IF NOT EXISTS "Campaign_tenantId_createdAt_idx" ON public."Campaign"("tenantId", "createdAt");`,

  `CREATE TABLE IF NOT EXISTS public."CampaignRecipient" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "messageId" TEXT,
  "status" public."CampaignRecipientStatus" NOT NULL DEFAULT 'QUEUED',
  "clicked" BOOLEAN NOT NULL DEFAULT false,
  "replied" BOOLEAN NOT NULL DEFAULT false,
  "converted" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "contactId" TEXT;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "messageId" TEXT;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "status" public."CampaignRecipientStatus" DEFAULT 'QUEUED';`,
  normalizeEnumColumn("CampaignRecipient", "status", "CampaignRecipientStatus", "QUEUED"),
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "clicked" BOOLEAN DEFAULT false;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "replied" BOOLEAN DEFAULT false;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "converted" BOOLEAN DEFAULT false;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "metadata" JSONB;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."CampaignRecipient" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."CampaignRecipient" SET "status" = 'QUEUED'::public."CampaignRecipientStatus" WHERE "status" IS NULL;`,
  `UPDATE public."CampaignRecipient" SET "clicked" = false WHERE "clicked" IS NULL;`,
  `UPDATE public."CampaignRecipient" SET "replied" = false WHERE "replied" IS NULL;`,
  `UPDATE public."CampaignRecipient" SET "converted" = false WHERE "converted" IS NULL;`,
  `UPDATE public."CampaignRecipient" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."CampaignRecipient" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "CampaignRecipient_tenantId_campaignId_idx" ON public."CampaignRecipient"("tenantId", "campaignId");`,
  `CREATE INDEX IF NOT EXISTS "CampaignRecipient_tenantId_status_idx" ON public."CampaignRecipient"("tenantId", "status");`,

  `CREATE TABLE IF NOT EXISTS public."AdCampaign" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "status" public."AdCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "budget" JSONB,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "audienceConfig" JSONB,
  "creativeConfig" JSONB,
  "automationConfig" JSONB,
  "metaCampaignId" TEXT,
  "metaAdSetId" TEXT,
  "metaAdId" TEXT,
  "stats" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "name" TEXT;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "objective" TEXT;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "platform" TEXT;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "status" public."AdCampaignStatus" DEFAULT 'DRAFT';`,
  normalizeEnumColumn("AdCampaign", "status", "AdCampaignStatus", "DRAFT"),
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "budget" JSONB;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "audienceConfig" JSONB;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "creativeConfig" JSONB;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "automationConfig" JSONB;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "metaCampaignId" TEXT;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "metaAdSetId" TEXT;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "metaAdId" TEXT;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "stats" JSONB;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "createdById" TEXT;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."AdCampaign" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."AdCampaign" SET "name" = COALESCE("name", CONCAT('Ad ', "id")) WHERE "name" IS NULL;`,
  `UPDATE public."AdCampaign" SET "objective" = COALESCE("objective", 'Click to WhatsApp') WHERE "objective" IS NULL;`,
  `UPDATE public."AdCampaign" SET "platform" = COALESCE("platform", 'Facebook + Instagram') WHERE "platform" IS NULL;`,
  `UPDATE public."AdCampaign" SET "status" = 'DRAFT'::public."AdCampaignStatus" WHERE "status" IS NULL;`,
  `UPDATE public."AdCampaign" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."AdCampaign" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "AdCampaign_tenantId_status_idx" ON public."AdCampaign"("tenantId", "status");`,
  `CREATE INDEX IF NOT EXISTS "AdCampaign_tenantId_createdAt_idx" ON public."AdCampaign"("tenantId", "createdAt");`,

  `CREATE TABLE IF NOT EXISTS public."Workflow" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" public."WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
  "graphJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "name" TEXT;`,
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "description" TEXT;`,
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "status" public."WorkflowStatus" DEFAULT 'DRAFT';`,
  normalizeEnumColumn("Workflow", "status", "WorkflowStatus", "DRAFT"),
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "graphJson" JSONB DEFAULT '{}'::jsonb;`,
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1;`,
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "createdById" TEXT;`,
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Workflow" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."Workflow" SET "name" = COALESCE("name", CONCAT('Workflow ', "id")) WHERE "name" IS NULL;`,
  `UPDATE public."Workflow" SET "status" = 'DRAFT'::public."WorkflowStatus" WHERE "status" IS NULL;`,
  `UPDATE public."Workflow" SET "graphJson" = '{}'::jsonb WHERE "graphJson" IS NULL;`,
  `UPDATE public."Workflow" SET "version" = 1 WHERE "version" IS NULL;`,
  `UPDATE public."Workflow" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."Workflow" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "Workflow_tenantId_status_idx" ON public."Workflow"("tenantId", "status");`,

  `CREATE TABLE IF NOT EXISTS public."WorkflowRun" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "conversationId" TEXT,
  "contactId" TEXT,
  "status" public."WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "error" TEXT
);`,
  `ALTER TABLE public."WorkflowRun" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."WorkflowRun" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."WorkflowRun" ADD COLUMN IF NOT EXISTS "workflowId" TEXT;`,
  `ALTER TABLE public."WorkflowRun" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;`,
  `ALTER TABLE public."WorkflowRun" ADD COLUMN IF NOT EXISTS "contactId" TEXT;`,
  `ALTER TABLE public."WorkflowRun" ADD COLUMN IF NOT EXISTS "status" public."WorkflowRunStatus" DEFAULT 'RUNNING';`,
  normalizeEnumColumn("WorkflowRun", "status", "WorkflowRunStatus", "RUNNING"),
  `ALTER TABLE public."WorkflowRun" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."WorkflowRun" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);`,
  `ALTER TABLE public."WorkflowRun" ADD COLUMN IF NOT EXISTS "error" TEXT;`,
  `UPDATE public."WorkflowRun" SET "status" = 'RUNNING'::public."WorkflowRunStatus" WHERE "status" IS NULL;`,
  `UPDATE public."WorkflowRun" SET "startedAt" = NOW() WHERE "startedAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "WorkflowRun_tenantId_workflowId_idx" ON public."WorkflowRun"("tenantId", "workflowId");`,
  `CREATE INDEX IF NOT EXISTS "WorkflowRun_tenantId_status_idx" ON public."WorkflowRun"("tenantId", "status");`,

  `CREATE TABLE IF NOT EXISTS public."WorkflowRunStep" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "workflowRunId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "nodeType" TEXT NOT NULL,
  "status" public."WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
  "input" JSONB,
  "output" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "workflowRunId" TEXT;`,
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "nodeId" TEXT;`,
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "nodeType" TEXT;`,
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "status" public."WorkflowRunStatus" DEFAULT 'RUNNING';`,
  normalizeEnumColumn("WorkflowRunStep", "status", "WorkflowRunStatus", "RUNNING"),
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "input" JSONB;`,
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "output" JSONB;`,
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "error" TEXT;`,
  `ALTER TABLE public."WorkflowRunStep" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."WorkflowRunStep" SET "nodeId" = COALESCE("nodeId", "id") WHERE "nodeId" IS NULL;`,
  `UPDATE public."WorkflowRunStep" SET "nodeType" = COALESCE("nodeType", 'Unknown') WHERE "nodeType" IS NULL;`,
  `UPDATE public."WorkflowRunStep" SET "status" = 'RUNNING'::public."WorkflowRunStatus" WHERE "status" IS NULL;`,
  `UPDATE public."WorkflowRunStep" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "WorkflowRunStep_tenantId_workflowRunId_idx" ON public."WorkflowRunStep"("tenantId", "workflowRunId");`,

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
  normalizeEnumColumn("ApiUsageLog", "featureKey", "FeatureKey", "INBOX"),
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "provider" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "eventType" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "units" INTEGER DEFAULT 1;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "cost" NUMERIC(12, 6) DEFAULT 0;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "status" TEXT;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "metadata" JSONB;`,
  `ALTER TABLE public."ApiUsageLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."ApiUsageLog" ALTER COLUMN "provider" TYPE TEXT USING "provider"::TEXT;`,
  dropNotNullIfColumnExists("ApiUsageLog", "companyId"),
  dropNotNullIfColumnExists("ApiUsageLog", "endpoint"),
  dropNotNullIfColumnExists("ApiUsageLog", "method"),
  dropNotNullIfColumnExists("ApiUsageLog", "statusCode"),
  dropNotNullIfColumnExists("ApiUsageLog", "success"),
  dropNotNullIfColumnExists("ApiUsageLog", "requestUnits"),
  dropNotNullIfColumnExists("ApiUsageLog", "metadata"),
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
  normalizeEnumColumn("Order", "status", "OrderStatus", "DRAFT"),
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "extractedByAI" BOOLEAN DEFAULT false;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION;`,
  `ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "source" public."ConversationSource" DEFAULT 'ORGANIC';`,
  normalizeEnumColumn("Order", "source", "ConversationSource", "ORGANIC"),
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
  normalizeEnumColumn("HumanQueueItem", "status", "HumanQueueStatus", "OPEN"),
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
  normalizeEnumColumn("KnowledgeDocument", "type", "KnowledgeDocumentType", "FAQ"),
  `ALTER TABLE public."KnowledgeDocument" ADD COLUMN IF NOT EXISTS "status" public."KnowledgeDocumentStatus" DEFAULT 'UPLOADED';`,
  normalizeEnumColumn("KnowledgeDocument", "status", "KnowledgeDocumentStatus", "UPLOADED"),
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
