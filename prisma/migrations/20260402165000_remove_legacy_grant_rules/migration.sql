-- Remove legacy grant-rules dependencies and move quote linkage to eligibility snapshots.

-- 1) Add new nullable quote linkage.
ALTER TABLE "Quote"
ADD COLUMN IF NOT EXISTS "eligibilityAssessmentId" TEXT;

-- 2) Backfill quote linkage to the latest assessment for each quote's project.
UPDATE "Quote" q
SET "eligibilityAssessmentId" = ea."id"
FROM "EligibilityAssessment" ea
WHERE q."projectId" = ea."projectId"
  AND ea."isLatest" = true
  AND q."eligibilityAssessmentId" IS NULL;

-- 3) Drop quote -> grantRulesVersion relation and column.
ALTER TABLE "Quote"
DROP CONSTRAINT IF EXISTS "Quote_grantRulesVersionId_fkey";

DROP INDEX IF EXISTS "Quote_grantRulesVersionId_idx";

ALTER TABLE "Quote"
DROP COLUMN IF EXISTS "grantRulesVersionId";

-- 4) Add quote -> eligibilityAssessment relation and index.
ALTER TABLE "Quote"
DROP CONSTRAINT IF EXISTS "Quote_eligibilityAssessmentId_fkey";

ALTER TABLE "Quote"
ADD CONSTRAINT "Quote_eligibilityAssessmentId_fkey"
FOREIGN KEY ("eligibilityAssessmentId")
REFERENCES "EligibilityAssessment"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Quote_eligibilityAssessmentId_idx";

CREATE INDEX IF NOT EXISTS "Quote_eligibilityAssessmentId_idx"
ON "Quote"("eligibilityAssessmentId");

-- 5) Drop eligibility -> grantRulesVersion relation and column.
ALTER TABLE "EligibilityAssessment"
DROP CONSTRAINT IF EXISTS "EligibilityAssessment_grantRulesVersionId_fkey";

DROP INDEX IF EXISTS "EligibilityAssessment_grantRulesVersionId_idx";

ALTER TABLE "EligibilityAssessment"
DROP COLUMN IF EXISTS "grantRulesVersionId";

-- 6) Drop legacy grant-rules tables.
DROP TABLE IF EXISTS "GrantRulesAuditLog";
DROP TABLE IF EXISTS "GrantRulesVersion";
