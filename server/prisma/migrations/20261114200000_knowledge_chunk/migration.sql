-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "idx" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "embeddingJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_agentId_idx" ON "KnowledgeChunk"("agentId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_orgId_idx" ON "KnowledgeChunk"("orgId");

