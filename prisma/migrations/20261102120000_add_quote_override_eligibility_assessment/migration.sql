-- AlterTable
ALTER TABLE "QuoteOverride" ADD COLUMN     "eligibilityAssessmentId" TEXT;

-- AddForeignKey
ALTER TABLE "QuoteOverride" ADD CONSTRAINT "QuoteOverride_eligibilityAssessmentId_fkey" FOREIGN KEY ("eligibilityAssessmentId") REFERENCES "EligibilityAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: each existing override's decision/grant edits were made against the
-- project's latest assessment at the time it was last saved, i.e. the latest
-- assessment created at or before its updatedAt. Overrides saved before the
-- project had any assessment stay null.
UPDATE "QuoteOverride" AS qo
SET "eligibilityAssessmentId" = (
  SELECT ea."id"
  FROM "EligibilityAssessment" AS ea
  JOIN "Quote" AS q ON q."projectId" = ea."projectId"
  WHERE q."id" = qo."quoteId"
    AND ea."createdAt" <= qo."updatedAt"
  ORDER BY ea."createdAt" DESC
  LIMIT 1
);
