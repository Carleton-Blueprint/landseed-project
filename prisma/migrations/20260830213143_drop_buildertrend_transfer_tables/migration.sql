-- DropForeignKey
ALTER TABLE "BuilderTrendStatusCallbackEvent" DROP CONSTRAINT "BuilderTrendStatusCallbackEvent_builderTrendTransferId_fkey";

-- DropForeignKey
ALTER TABLE "BuilderTrendStatusCallbackEvent" DROP CONSTRAINT "BuilderTrendStatusCallbackEvent_projectId_fkey";

-- DropForeignKey
ALTER TABLE "BuilderTrendTransfer" DROP CONSTRAINT "BuilderTrendTransfer_lastManualSyncByUserId_fkey";

-- DropForeignKey
ALTER TABLE "BuilderTrendTransfer" DROP CONSTRAINT "BuilderTrendTransfer_projectId_fkey";

-- DropForeignKey
ALTER TABLE "BuilderTrendTransfer" DROP CONSTRAINT "BuilderTrendTransfer_quoteId_fkey";

-- DropTable
DROP TABLE "BuilderTrendStatusCallbackEvent";

-- DropTable
DROP TABLE "BuilderTrendTransfer";

-- DropEnum
DROP TYPE "BuilderTrendTransferStatus";

