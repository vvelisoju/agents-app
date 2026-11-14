-- DB-7..12: add orgId for direct tenant scoping (+ indexes). Columns are nullable and
-- backfilled from each row's owning agent; a later migration enforces NOT NULL once
-- verified on a prod-scale clone (DB-24).

-- Add nullable orgId
ALTER TABLE "ChannelSession" ADD COLUMN "orgId" TEXT;
ALTER TABLE "TrainingProfile" ADD COLUMN "orgId" TEXT;
ALTER TABLE "TrainingSource" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Message" ADD COLUMN "orgId" TEXT;

-- Backfill from the owning agent
UPDATE "ChannelSession" SET "orgId" = a."orgId" FROM "Agent" a WHERE "ChannelSession"."agentId" = a."id" AND "ChannelSession"."orgId" IS NULL;
UPDATE "TrainingProfile" SET "orgId" = a."orgId" FROM "Agent" a WHERE "TrainingProfile"."agentId" = a."id" AND "TrainingProfile"."orgId" IS NULL;
UPDATE "TrainingSource" SET "orgId" = a."orgId" FROM "Agent" a WHERE "TrainingSource"."agentId" = a."id" AND "TrainingSource"."orgId" IS NULL;
UPDATE "Message" SET "orgId" = a."orgId" FROM "Agent" a WHERE "Message"."agentId" = a."id" AND "Message"."orgId" IS NULL;

-- Indexes
CREATE INDEX "ChannelSession_orgId_idx" ON "ChannelSession"("orgId");
CREATE INDEX "TrainingProfile_orgId_idx" ON "TrainingProfile"("orgId");
CREATE INDEX "TrainingSource_orgId_idx" ON "TrainingSource"("orgId");
CREATE INDEX "Message_orgId_idx" ON "Message"("orgId");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "UsageEvent_orgId_createdAt_idx" ON "UsageEvent"("orgId", "createdAt");
