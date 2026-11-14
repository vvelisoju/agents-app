-- CreateTable
CREATE TABLE "OutboundConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'trackly',
    "tokenEnc" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 50,
    "windowStart" INTEGER NOT NULL DEFAULT 10,
    "windowEnd" INTEGER NOT NULL DEFAULT 18,
    "minGapSec" INTEGER NOT NULL DEFAULT 240,
    "maxGapSec" INTEGER NOT NULL DEFAULT 420,
    "warmupDays" INTEGER NOT NULL DEFAULT 5,
    "warmupStart" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "riskAckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundSendLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL DEFAULT '',
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundOptOut" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundConnection_orgId_idx" ON "OutboundConnection"("orgId");

-- CreateIndex
CREATE INDEX "OutboundConnection_agentId_idx" ON "OutboundConnection"("agentId");

-- CreateIndex
CREATE INDEX "OutboundSendLog_orgId_createdAt_idx" ON "OutboundSendLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundSendLog_connectionId_createdAt_idx" ON "OutboundSendLog"("connectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundSendLog_connectionId_campaignId_recipient_key" ON "OutboundSendLog"("connectionId", "campaignId", "recipient");

-- CreateIndex
CREATE INDEX "OutboundOptOut_orgId_idx" ON "OutboundOptOut"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundOptOut_agentId_phone_key" ON "OutboundOptOut"("agentId", "phone");

