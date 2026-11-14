-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "executionMode" TEXT NOT NULL DEFAULT 'reply';

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "agentVersion" TEXT,
ADD COLUMN     "approvalState" TEXT,
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "costMicros" INTEGER,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "executionId" TEXT,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "trigger" TEXT;

