-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryThrough" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summaryUpdatedAt" TIMESTAMP(3);

