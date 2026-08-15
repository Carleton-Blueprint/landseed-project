-- CreateEnum
CREATE TYPE "PhotoGenerationStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "AuditEventCategory" ADD VALUE 'AI_GENERATION';

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "generatedImageS3Key" TEXT,
ADD COLUMN     "generatedImageUrl" TEXT,
ADD COLUMN     "generationCostUsd" DECIMAL(10,4),
ADD COLUMN     "generationError" TEXT,
ADD COLUMN     "generationModel" TEXT,
ADD COLUMN     "generationStatus" "PhotoGenerationStatus" NOT NULL DEFAULT 'PENDING';
