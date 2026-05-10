-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('EMAIL', 'SMS', 'IN_APP_NOTIFICATION', 'SYSTEM_MESSAGE');

-- CreateEnum
CREATE TYPE "CommunicationCategory" AS ENUM ('ESTIMATE', 'QUESTION', 'DOCUMENT', 'GRANT_STATUS', 'SUBMISSION_RECEIPT', 'SURVEY', 'SYSTEM_ALERT', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ', 'BOUNCED');

-- CreateTable
CREATE TABLE "CommunicationHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "communicationType" "CommunicationType" NOT NULL,
    "category" "CommunicationCategory" NOT NULL,
    "recipientId" TEXT,
    "senderId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "contentSummary" TEXT NOT NULL,
    "linkedResourceType" TEXT,
    "linkedResourceId" TEXT,
    "status" "CommunicationStatus" NOT NULL,
    "metadata" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunicationHistory_projectId_sentAt_idx" ON "CommunicationHistory"("projectId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "CommunicationHistory_recipientId_projectId_idx" ON "CommunicationHistory"("recipientId", "projectId");

-- CreateIndex
CREATE INDEX "CommunicationHistory_category_idx" ON "CommunicationHistory"("category");

-- CreateIndex
CREATE INDEX "CommunicationHistory_communicationType_idx" ON "CommunicationHistory"("communicationType");

-- CreateIndex
CREATE INDEX "CommunicationHistory_status_idx" ON "CommunicationHistory"("status");

-- AddForeignKey
ALTER TABLE "CommunicationHistory" ADD CONSTRAINT "CommunicationHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationHistory" ADD CONSTRAINT "CommunicationHistory_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationHistory" ADD CONSTRAINT "CommunicationHistory_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
