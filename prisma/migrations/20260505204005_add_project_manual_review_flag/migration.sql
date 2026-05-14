-- CreateEnum
CREATE TYPE "ProjectManualReviewReasonCode" AS ENUM ('LOW_CONFIDENCE', 'HIGH_COMPLEXITY', 'BOTH');

-- CreateTable
CREATE TABLE "ProjectManualReviewFlag" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reason" "ProjectManualReviewReasonCode" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluationEligibilityAssessmentId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectManualReviewFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectManualReviewFlag_projectId_key" ON "ProjectManualReviewFlag"("projectId");

-- CreateIndex
CREATE INDEX "ProjectManualReviewFlag_projectId_idx" ON "ProjectManualReviewFlag"("projectId");

-- CreateIndex
CREATE INDEX "ProjectManualReviewFlag_isActive_idx" ON "ProjectManualReviewFlag"("isActive");

-- CreateIndex
CREATE INDEX "ProjectManualReviewFlag_reason_idx" ON "ProjectManualReviewFlag"("reason");

-- CreateIndex
CREATE INDEX "ProjectManualReviewFlag_createdAt_idx" ON "ProjectManualReviewFlag"("createdAt");

-- AddForeignKey
ALTER TABLE "ProjectManualReviewFlag" ADD CONSTRAINT "ProjectManualReviewFlag_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
