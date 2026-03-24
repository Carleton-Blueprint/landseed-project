-- CreateEnum
CREATE TYPE "EligibilityDecision" AS ENUM (
    'ELIGIBLE',
    'INELIGIBLE',
    'NEEDS_MORE_INFO',
    'MANUAL_REVIEW'
);

-- CreateTable
CREATE TABLE "EligibilityAssessment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "grantRulesVersionId" TEXT NOT NULL,
    "overallDecision" "EligibilityDecision" NOT NULL,
    "programDecisions" JSONB NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "missingRequirements" JSONB NOT NULL,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EligibilityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EligibilityAssessment_projectId_idx"
ON "EligibilityAssessment"("projectId");

-- CreateIndex
CREATE INDEX "EligibilityAssessment_grantRulesVersionId_idx"
ON "EligibilityAssessment"("grantRulesVersionId");

-- CreateIndex
CREATE INDEX "EligibilityAssessment_projectId_isLatest_idx"
ON "EligibilityAssessment"("projectId", "isLatest");

-- CreateIndex
CREATE INDEX "EligibilityAssessment_createdAt_idx"
ON "EligibilityAssessment"("createdAt");

-- AddForeignKey
ALTER TABLE "EligibilityAssessment"
ADD CONSTRAINT "EligibilityAssessment_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityAssessment"
ADD CONSTRAINT "EligibilityAssessment_grantRulesVersionId_fkey"
FOREIGN KEY ("grantRulesVersionId") REFERENCES "GrantRulesVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
