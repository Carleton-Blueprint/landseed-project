-- CreateEnum
CREATE TYPE "ManualFallbackExportStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'MANUAL_FALLBACK_EXPORT_READY';

-- CreateTable
CREATE TABLE "ManualFallbackExport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByEmail" TEXT,
    "requestedByName" TEXT,
    "status" "ManualFallbackExportStatus" NOT NULL DEFAULT 'PENDING',
    "s3Key" TEXT,
    "fileName" TEXT,
    "retentionDays" INTEGER NOT NULL,
    "maxSizeBytes" INTEGER,
    "lastError" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualFallbackExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualFallbackExport_projectId_idx" ON "ManualFallbackExport"("projectId");

-- CreateIndex
CREATE INDEX "ManualFallbackExport_requestedByUserId_idx" ON "ManualFallbackExport"("requestedByUserId");

-- CreateIndex
CREATE INDEX "ManualFallbackExport_status_idx" ON "ManualFallbackExport"("status");

-- CreateIndex
CREATE INDEX "ManualFallbackExport_expiresAt_idx" ON "ManualFallbackExport"("expiresAt");

-- AddForeignKey
ALTER TABLE "ManualFallbackExport" ADD CONSTRAINT "ManualFallbackExport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualFallbackExport" ADD CONSTRAINT "ManualFallbackExport_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;