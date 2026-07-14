-- Remove legacy pricing-matrix-version dependencies.
-- Runtime pricing is now driven entirely by live SerpAPI lookups (see
-- src/backend/services/pricing.ts / refinedEstimate.ts); PricingMatrixVersion
-- rows and the required Quote.pricingMatrixVersionId FK were never read by
-- that pricing logic, only written to satisfy a constraint.

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_pricingMatrixVersionId_fkey";

-- DropForeignKey
ALTER TABLE "PricingMatrixVersion" DROP CONSTRAINT "PricingMatrixVersion_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "PricingMatrixAuditLog" DROP CONSTRAINT "PricingMatrixAuditLog_changedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "PricingMatrixAuditLog" DROP CONSTRAINT "PricingMatrixAuditLog_versionId_fkey";

-- DropIndex
DROP INDEX "Quote_pricingMatrixVersionId_idx";

-- AlterTable
ALTER TABLE "Quote" DROP COLUMN "pricingMatrixVersionId";

-- DropTable
DROP TABLE "PricingMatrixAuditLog";

-- DropTable
DROP TABLE "PricingMatrixVersion";
