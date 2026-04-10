-- Create enum for BuilderTrend transfer state tracking
CREATE TYPE "BuilderTrendTransferStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- Create transfer tracking table for estimate approval -> BuilderTrend handoff
CREATE TABLE "BuilderTrendTransfer" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "status" "BuilderTrendTransferStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "externalReference" TEXT,
    "lastError" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuilderTrendTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuilderTrendTransfer_idempotencyKey_key" ON "BuilderTrendTransfer"("idempotencyKey");
CREATE UNIQUE INDEX "BuilderTrendTransfer_quoteId_key" ON "BuilderTrendTransfer"("quoteId");
CREATE INDEX "BuilderTrendTransfer_projectId_idx" ON "BuilderTrendTransfer"("projectId");
CREATE INDEX "BuilderTrendTransfer_status_idx" ON "BuilderTrendTransfer"("status");

ALTER TABLE "BuilderTrendTransfer"
  ADD CONSTRAINT "BuilderTrendTransfer_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuilderTrendTransfer"
  ADD CONSTRAINT "BuilderTrendTransfer_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
