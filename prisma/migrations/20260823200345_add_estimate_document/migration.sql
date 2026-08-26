-- CreateEnum
CREATE TYPE "EstimateDocumentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "EstimateDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "status" "EstimateDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "contentHash" TEXT,
    "s3Key" TEXT,
    "fileName" TEXT,
    "version" INTEGER NOT NULL,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstimateDocument_projectId_idx" ON "EstimateDocument"("projectId");

-- CreateIndex
CREATE INDEX "EstimateDocument_quoteId_isLatest_idx" ON "EstimateDocument"("quoteId", "isLatest");

-- AddForeignKey
ALTER TABLE "EstimateDocument" ADD CONSTRAINT "EstimateDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateDocument" ADD CONSTRAINT "EstimateDocument_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
