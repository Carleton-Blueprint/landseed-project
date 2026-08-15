-- AlterEnum
ALTER TYPE "ProjectManualReviewReasonCode" ADD VALUE 'PHOTO_MODIFICATION_MISMATCH';

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "aiConfidence" TEXT,
ADD COLUMN     "aiModificationCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "analysisError" TEXT,
ADD COLUMN     "analysisModel" TEXT,
ADD COLUMN     "analysisStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "analyzedAt" TIMESTAMP(3);
