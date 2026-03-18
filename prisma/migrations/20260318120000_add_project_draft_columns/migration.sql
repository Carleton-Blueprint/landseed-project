-- Add draft persistence fields expected by /api/draft.
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "draftData" JSONB,
  ADD COLUMN IF NOT EXISTS "grantDocumentKey" TEXT;
