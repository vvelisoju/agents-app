-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "currentVersionId" TEXT,
ADD COLUMN     "lifecycleStatus" TEXT NOT NULL DEFAULT 'draft';

-- CreateTable
CREATE TABLE "AgentVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "specJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentVersion_agentId_idx" ON "AgentVersion"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentVersion_agentId_version_key" ON "AgentVersion"("agentId", "version");

-- AddForeignKey
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- SPEC-28: backfill lifecycleStatus for existing agents from connection/paused state
UPDATE "Agent" SET "lifecycleStatus" = CASE WHEN "paused" = true THEN 'paused' WHEN "status" = 'connected' THEN 'active' ELSE 'draft' END;
