-- DropIndex
DROP INDEX "BuilderTrendTransfer_idempotencyKey_key";

-- AlterTable
ALTER TABLE "BuilderTrendTransfer" DROP COLUMN "idempotencyKey";
