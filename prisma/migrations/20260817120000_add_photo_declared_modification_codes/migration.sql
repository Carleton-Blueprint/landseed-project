-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "declaredModificationCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
