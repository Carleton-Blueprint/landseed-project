/*
  Warnings:

  - The `status` column on the `AccountDeletionNotice` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "AccountDeletionNoticeStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "AccountDeletionNotice" DROP COLUMN "status",
ADD COLUMN     "status" "AccountDeletionNoticeStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "AccountDeletionNotice_status_idx" ON "AccountDeletionNotice"("status");
