-- CreateTable
CREATE TABLE "ContactMemory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMemory_orgId_idx" ON "ContactMemory"("orgId");

-- CreateIndex
CREATE INDEX "ContactMemory_agentId_contactNumber_idx" ON "ContactMemory"("agentId", "contactNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ContactMemory_agentId_contactNumber_key_key" ON "ContactMemory"("agentId", "contactNumber", "key");

