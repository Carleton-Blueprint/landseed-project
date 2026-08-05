-- CreateTable
CREATE TABLE "AdminDigestRun" (
    "id" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "eventCount" INTEGER NOT NULL,

    CONSTRAINT "AdminDigestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminDigestRun_sentAt_idx" ON "AdminDigestRun"("sentAt");
