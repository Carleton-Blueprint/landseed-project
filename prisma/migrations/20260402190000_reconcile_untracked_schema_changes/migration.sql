-- Reconcile schema objects present in DB but absent from local migration history.
-- This migration is intentionally idempotent to preserve local data.

-- Cleanup temporary migration backup table created during reconciliation.
DROP TABLE IF EXISTS "_prisma_migrations_backup_20260402";

-- Enums required by Document and QuoteQuestion.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentType') THEN
    CREATE TYPE "DocumentType" AS ENUM (
      'PROOF_OF_INCOME',
      'MEDICAL_DOCUMENTATION',
      'PROPERTY_OWNERSHIP',
      'INSURANCE_DOCUMENT',
      'GOVERNMENT_ID',
      'TAX_ASSESSMENT',
      'DISABILITY_CERTIFICATE',
      'OTHER'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentReviewStatus') THEN
    CREATE TYPE "DocumentReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuestionCategory') THEN
    CREATE TYPE "QuestionCategory" AS ENUM (
      'PRICING',
      'SCOPE',
      'TIMELINE',
      'MATERIALS',
      'GRANT_ELIGIBILITY',
      'MODIFICATION_REQUEST',
      'GENERAL'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuestionStatus') THEN
    CREATE TYPE "QuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');
  END IF;
END $$;

-- Document table and constraints.
CREATE TABLE IF NOT EXISTS "Document" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "s3Key" TEXT NOT NULL,
  "s3Url" TEXT NOT NULL,
  "documentType" "DocumentType" NOT NULL,
  "label" TEXT,
  "virusScanStatus" TEXT NOT NULL DEFAULT 'pending',
  "reviewStatus" "DocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
  "reviewNote" TEXT,
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Document_projectId_idx" ON "Document"("projectId");
CREATE INDEX IF NOT EXISTS "Document_documentType_idx" ON "Document"("documentType");
CREATE INDEX IF NOT EXISTS "Document_virusScanStatus_idx" ON "Document"("virusScanStatus");
CREATE INDEX IF NOT EXISTS "Document_reviewStatus_idx" ON "Document"("reviewStatus");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Document_projectId_fkey'
  ) THEN
    ALTER TABLE "Document"
    ADD CONSTRAINT "Document_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

-- QuoteQuestion table and constraints.
CREATE TABLE IF NOT EXISTS "QuoteQuestion" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "category" "QuestionCategory" NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "QuestionStatus" NOT NULL DEFAULT 'OPEN',
  "response" TEXT,
  "respondedAt" TIMESTAMP(3),
  "askedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuoteQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QuoteQuestion_quoteId_idx" ON "QuoteQuestion"("quoteId");
CREATE INDEX IF NOT EXISTS "QuoteQuestion_status_idx" ON "QuoteQuestion"("status");
CREATE INDEX IF NOT EXISTS "QuoteQuestion_askedByUserId_idx" ON "QuoteQuestion"("askedByUserId");
CREATE INDEX IF NOT EXISTS "QuoteQuestion_quoteId_status_idx" ON "QuoteQuestion"("quoteId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QuoteQuestion_quoteId_fkey'
  ) THEN
    ALTER TABLE "QuoteQuestion"
    ADD CONSTRAINT "QuoteQuestion_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "Quote"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

-- Discovery columns on EligibilityAssessment.
ALTER TABLE "EligibilityAssessment" ADD COLUMN IF NOT EXISTS "discoveredGrants" JSONB;
ALTER TABLE "EligibilityAssessment" ADD COLUMN IF NOT EXISTS "discoveryMetadata" JSONB;
ALTER TABLE "EligibilityAssessment" ADD COLUMN IF NOT EXISTS "discoveryProvider" TEXT;
ALTER TABLE "EligibilityAssessment" ADD COLUMN IF NOT EXISTS "discoveryEngineVersion" TEXT;
ALTER TABLE "EligibilityAssessment" ADD COLUMN IF NOT EXISTS "discoveryPromptVersion" TEXT;
ALTER TABLE "EligibilityAssessment" ADD COLUMN IF NOT EXISTS "discoveryScoringVersion" TEXT;
ALTER TABLE "EligibilityAssessment" ADD COLUMN IF NOT EXISTS "discoveryModelVersion" TEXT;
ALTER TABLE "EligibilityAssessment" ADD COLUMN IF NOT EXISTS "discoverySourceSnapshotId" TEXT;
