-- AlterEnum
ALTER TYPE "QuoteStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "lastClientActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing rows so the inactivity clock starts from the last generated estimate time.
UPDATE "Quote"
SET "lastClientActivityAt" = COALESCE("generatedAt", "updatedAt", "createdAt");
