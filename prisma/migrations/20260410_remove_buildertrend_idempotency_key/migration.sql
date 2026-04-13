-- DropIndex
DROP INDEX IF EXISTS "BuilderTrendTransfer_idempotencyKey_key";

-- AlterTable
ALTER TABLE IF EXISTS "BuilderTrendTransfer" DROP COLUMN IF EXISTS "idempotencyKey";
