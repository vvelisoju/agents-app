-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "connectorAccess" TEXT NOT NULL DEFAULT 'customer';

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorOp" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'customer',
    "sideEffect" TEXT NOT NULL DEFAULT 'read',
    "specJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorOp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Connector_orgId_idx" ON "Connector"("orgId");

-- CreateIndex
CREATE INDEX "ConnectorOp_connectorId_idx" ON "ConnectorOp"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorOp_orgId_name_key" ON "ConnectorOp"("orgId", "name");

-- AddForeignKey
ALTER TABLE "ConnectorOp" ADD CONSTRAINT "ConnectorOp_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

