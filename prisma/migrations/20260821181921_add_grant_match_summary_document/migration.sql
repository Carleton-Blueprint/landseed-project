-- CreateEnum
CREATE TYPE "GrantMatchSummaryDocumentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "GrantMatchSummaryDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eligibilityAssessmentId" TEXT NOT NULL,
    "status" "GrantMatchSummaryDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "outputSource" TEXT,
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

    CONSTRAINT "GrantMatchSummaryDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrantMatchSummaryDocument_projectId_isLatest_idx" ON "GrantMatchSummaryDocument"("projectId", "isLatest");

-- CreateIndex
CREATE INDEX "GrantMatchSummaryDocument_projectId_idx" ON "GrantMatchSummaryDocument"("projectId");

-- AddForeignKey
ALTER TABLE "GrantMatchSummaryDocument" ADD CONSTRAINT "GrantMatchSummaryDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
