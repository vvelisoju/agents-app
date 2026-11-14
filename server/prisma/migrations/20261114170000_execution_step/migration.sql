-- CreateTable
CREATE TABLE "ExecutionStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL DEFAULT '{}',
    "outcome" TEXT NOT NULL,
    "approvalState" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutionStep_executionId_stepIndex_idx" ON "ExecutionStep"("executionId", "stepIndex");

-- CreateIndex
CREATE INDEX "ExecutionStep_orgId_createdAt_idx" ON "ExecutionStep"("orgId", "createdAt");

