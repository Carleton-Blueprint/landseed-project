-- Prisma's schema DSL can't express a partial unique index, so this is
-- hand-written rather than generated from a schema.prisma diff.
--
-- Backstops the pg_advisory_xact_lock added in
-- createEligibilityAssessmentSnapshot (repository.ts): guarantees at the
-- database level that a project can never end up with two
-- EligibilityAssessment rows both marked isLatest = true, even if that lock
-- is ever bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS "EligibilityAssessment_projectId_isLatest_unique"
ON "EligibilityAssessment" ("projectId")
WHERE "isLatest" = true;
