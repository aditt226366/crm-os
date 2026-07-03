ALTER TABLE "Conversation"
ADD COLUMN IF NOT EXISTS "aiRepliesStopped" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Conversation"
SET "aiRepliesStopped" = false
WHERE "aiRepliesStopped" IS NULL;
