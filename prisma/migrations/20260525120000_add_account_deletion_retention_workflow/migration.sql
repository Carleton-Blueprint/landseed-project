-- CreateEnum
CREATE TYPE "AccountDeletionRequestStatus" AS ENUM ('REQUESTED', 'IN_GRACE_PERIOD', 'CANCELLED', 'READY_FOR_DELETION', 'DELETED');

-- CreateEnum
CREATE TYPE "AccountDeletionNoticeType" AS ENUM ('ADVANCE_NOTICE', 'FINAL_NOTICE');

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetUserEmailSnapshot" TEXT NOT NULL,
    "targetUserNameSnapshot" TEXT,
    "requestedByUserId" TEXT,
    "requestedByEmailSnapshot" TEXT,
    "requestedByNameSnapshot" TEXT,
    "status" "AccountDeletionRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gracePeriodEndsAt" TIMESTAMP(3) NOT NULL,
    "advanceNoticeDueAt" TIMESTAMP(3) NOT NULL,
    "noticeSentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestMetadata" JSONB,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionNotice" (
    "id" TEXT NOT NULL,
    "accountDeletionRequestId" TEXT NOT NULL,
    "noticeType" "AccountDeletionNoticeType" NOT NULL,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'PENDING',
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "subject" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "communicationHistoryId" TEXT,
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletionNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_targetUserId_idx" ON "AccountDeletionRequest"("targetUserId");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_requestedByUserId_idx" ON "AccountDeletionRequest"("requestedByUserId");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_status_idx" ON "AccountDeletionRequest"("status");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_requestedAt_idx" ON "AccountDeletionRequest"("requestedAt" DESC);

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_gracePeriodEndsAt_idx" ON "AccountDeletionRequest"("gracePeriodEndsAt");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_advanceNoticeDueAt_idx" ON "AccountDeletionRequest"("advanceNoticeDueAt");

-- CreateIndex
CREATE INDEX "AccountDeletionNotice_accountDeletionRequestId_noticeType_idx" ON "AccountDeletionNotice"("accountDeletionRequestId", "noticeType");

-- CreateIndex
CREATE INDEX "AccountDeletionNotice_status_idx" ON "AccountDeletionNotice"("status");

-- CreateIndex
CREATE INDEX "AccountDeletionNotice_scheduledFor_idx" ON "AccountDeletionNotice"("scheduledFor");

-- CreateIndex
CREATE INDEX "AccountDeletionNotice_sentAt_idx" ON "AccountDeletionNotice"("sentAt");

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionNotice" ADD CONSTRAINT "AccountDeletionNotice_accountDeletionRequestId_fkey" FOREIGN KEY ("accountDeletionRequestId") REFERENCES "AccountDeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;