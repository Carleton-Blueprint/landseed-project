/*
  Warnings:

  - You are about to drop the column `idempotencyKey` on the `BuilderTrendTransfer` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "BuilderTrendTransfer_idempotencyKey_key";

-- AlterTable
ALTER TABLE "BuilderTrendTransfer" DROP COLUMN "idempotencyKey",
ALTER COLUMN "updatedAt" DROP DEFAULT;
