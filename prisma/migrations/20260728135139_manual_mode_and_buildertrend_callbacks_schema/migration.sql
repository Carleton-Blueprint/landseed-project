-- CreateEnum
CREATE TYPE "ManualModeSubmissionStatus" AS ENUM ('DRAFT', 'READY', 'PACKAGE_GENERATED');

-- CreateEnum
CREATE TYPE "QuoteSource" AS ENUM ('AI_GENERATED', 'MANUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'MANUAL_MODE_DRAWING';
ALTER TYPE "DocumentType" ADD VALUE 'VENDOR_QUOTE';

-- AlterTable
ALTER TABLE "BuilderTrendTransfer" ADD COLUMN     "externalStatus" TEXT,
ADD COLUMN     "lastManualSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastManualSyncByUserId" TEXT,
ADD COLUMN     "lastStatusCallbackAt" TIMESTAMP(3),
ADD COLUMN     "workOrderUrl" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "isManualMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "manualModeSubmissionId" TEXT,
ADD COLUMN     "source" "QuoteSource" NOT NULL DEFAULT 'AI_GENERATED';

-- CreateTable
CREATE TABLE "BuilderTrendStatusCallbackEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "builderTrendTransferId" TEXT,
    "externalReference" TEXT,
    "previousStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "previousProjectStatus" TEXT,
    "newProjectStatus" TEXT,
    "rawPayload" JSONB NOT NULL,
    "validationError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "BuilderTrendStatusCallbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualModeSubmission" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "modificationType" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "pricingItems" JSONB NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "status" "ManualModeSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "enteredByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualModeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuilderTrendStatusCallbackEvent_projectId_receivedAt_idx" ON "BuilderTrendStatusCallbackEvent"("projectId", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "BuilderTrendStatusCallbackEvent_builderTrendTransferId_idx" ON "BuilderTrendStatusCallbackEvent"("builderTrendTransferId");

-- CreateIndex
CREATE INDEX "BuilderTrendStatusCallbackEvent_externalReference_idx" ON "BuilderTrendStatusCallbackEvent"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "ManualModeSubmission_projectId_key" ON "ManualModeSubmission"("projectId");

-- CreateIndex
CREATE INDEX "ManualModeSubmission_projectId_idx" ON "ManualModeSubmission"("projectId");

-- CreateIndex
CREATE INDEX "ManualModeSubmission_status_idx" ON "ManualModeSubmission"("status");

-- CreateIndex
CREATE INDEX "Quote_manualModeSubmissionId_idx" ON "Quote"("manualModeSubmissionId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_manualModeSubmissionId_fkey" FOREIGN KEY ("manualModeSubmissionId") REFERENCES "ManualModeSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderTrendTransfer" ADD CONSTRAINT "BuilderTrendTransfer_lastManualSyncByUserId_fkey" FOREIGN KEY ("lastManualSyncByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderTrendStatusCallbackEvent" ADD CONSTRAINT "BuilderTrendStatusCallbackEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderTrendStatusCallbackEvent" ADD CONSTRAINT "BuilderTrendStatusCallbackEvent_builderTrendTransferId_fkey" FOREIGN KEY ("builderTrendTransferId") REFERENCES "BuilderTrendTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualModeSubmission" ADD CONSTRAINT "ManualModeSubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualModeSubmission" ADD CONSTRAINT "ManualModeSubmission_enteredByUserId_fkey" FOREIGN KEY ("enteredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
