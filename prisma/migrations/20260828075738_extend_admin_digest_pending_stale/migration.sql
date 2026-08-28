-- AlterTable
ALTER TABLE "AdminDigestRun" ADD COLUMN     "pendingEstimateCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "staleInfoRequestCount" INTEGER NOT NULL DEFAULT 0;
