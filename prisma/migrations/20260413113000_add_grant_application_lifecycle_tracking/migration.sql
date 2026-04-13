-- CreateEnum
CREATE TYPE "GrantApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "grantApplicationStatus" "GrantApplicationStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "GrantApplicationStatusHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromStatus" "GrantApplicationStatus",
    "toStatus" "GrantApplicationStatus" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "GrantApplicationStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrantApplicationStatusHistory_projectId_changedAt_idx" ON "GrantApplicationStatusHistory"("projectId", "changedAt" DESC);

-- CreateIndex
CREATE INDEX "GrantApplicationStatusHistory_changedByUserId_changedAt_idx" ON "GrantApplicationStatusHistory"("changedByUserId", "changedAt" DESC);

-- AddForeignKey
ALTER TABLE "GrantApplicationStatusHistory" ADD CONSTRAINT "GrantApplicationStatusHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantApplicationStatusHistory" ADD CONSTRAINT "GrantApplicationStatusHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

