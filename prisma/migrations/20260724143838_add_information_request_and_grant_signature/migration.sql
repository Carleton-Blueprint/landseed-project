-- CreateEnum
CREATE TYPE "InformationRequestType" AS ENUM ('PHOTOS', 'DOCUMENTS', 'GENERAL_INFORMATION');

-- CreateEnum
CREATE TYPE "InformationRequestStatus" AS ENUM ('PENDING', 'RESPONDED', 'FOLLOW_UP_FLAGGED');

-- CreateEnum
CREATE TYPE "GrantAcknowledgementType" AS ENUM ('CONSENT_TO_SUBMIT', 'ACCURACY_ATTESTATION', 'INFORMATION_SHARING_CONSENT', 'TERMS_AND_CONDITIONS');

-- CreateTable
CREATE TABLE "InformationRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestType" "InformationRequestType" NOT NULL,
    "message" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "InformationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "followUpFlaggedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InformationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantSignature" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "acknowledgementType" "GrantAcknowledgementType" NOT NULL,
    "signatureData" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InformationRequest_projectId_idx" ON "InformationRequest"("projectId");

-- CreateIndex
CREATE INDEX "InformationRequest_status_idx" ON "InformationRequest"("status");

-- CreateIndex
CREATE INDEX "InformationRequest_createdAt_idx" ON "InformationRequest"("createdAt");

-- CreateIndex
CREATE INDEX "InformationRequest_status_createdAt_idx" ON "InformationRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GrantSignature_projectId_idx" ON "GrantSignature"("projectId");

-- CreateIndex
CREATE INDEX "GrantSignature_signerUserId_idx" ON "GrantSignature"("signerUserId");

-- CreateIndex
CREATE INDEX "GrantSignature_projectId_acknowledgementType_idx" ON "GrantSignature"("projectId", "acknowledgementType");

-- AddForeignKey
ALTER TABLE "InformationRequest" ADD CONSTRAINT "InformationRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationRequest" ADD CONSTRAINT "InformationRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantSignature" ADD CONSTRAINT "GrantSignature_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantSignature" ADD CONSTRAINT "GrantSignature_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

