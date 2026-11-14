-- CreateTable
CREATE TABLE "Watch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "cronExpr" TEXT NOT NULL DEFAULT '0 * * * *',
    "notifyNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "triggerId" TEXT,
    "lastHash" TEXT,
    "lastSnapshot" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "lastChangeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Watch_orgId_idx" ON "Watch"("orgId");

-- CreateIndex
CREATE INDEX "Watch_agentId_idx" ON "Watch"("agentId");

