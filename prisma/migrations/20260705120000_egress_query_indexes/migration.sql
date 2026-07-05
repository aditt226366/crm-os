CREATE INDEX IF NOT EXISTS "Conversation_tenantId_lastMessageAt_id_idx"
ON "Conversation"("tenantId", "lastMessageAt", "id");

CREATE INDEX IF NOT EXISTS "Message_tenantId_conversationId_createdAt_id_idx"
ON "Message"("tenantId", "conversationId", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "Lead_tenantId_updatedAt_id_idx"
ON "Lead"("tenantId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "Order_tenantId_status_createdAt_idx"
ON "Order"("tenantId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "HumanQueueItem_tenantId_status_priority_createdAt_idx"
ON "HumanQueueItem"("tenantId", "status", "priority", "createdAt");
