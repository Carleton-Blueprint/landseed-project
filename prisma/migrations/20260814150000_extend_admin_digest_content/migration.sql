-- AlterTable
ALTER TABLE "AdminDigestRun" ADD COLUMN     "newSubmissionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "staffActionCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AdminDigestDeliveryFailure" (
    "id" TEXT NOT NULL,
    "digestRunId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminDigestDeliveryFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminDigestDeliveryFailure_digestRunId_idx" ON "AdminDigestDeliveryFailure"("digestRunId");

-- CreateIndex
CREATE INDEX "AdminDigestDeliveryFailure_failedAt_idx" ON "AdminDigestDeliveryFailure"("failedAt");

-- AddForeignKey
ALTER TABLE "AdminDigestDeliveryFailure" ADD CONSTRAINT "AdminDigestDeliveryFailure_digestRunId_fkey" FOREIGN KEY ("digestRunId") REFERENCES "AdminDigestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
