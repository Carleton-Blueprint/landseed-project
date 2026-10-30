-- CreateEnum
CREATE TYPE "EligibilityAssessmentSource" AS ENUM ('AUTOMATIC', 'ADMIN');

-- CreateEnum
CREATE TYPE "EligibilityAdminAction" AS ENUM ('PRE_ESTIMATE_OVERRIDE', 'REASSESS', 'MANUAL_GRANTS');

-- AlterTable
ALTER TABLE "EligibilityAssessment" ADD COLUMN     "adminAction" "EligibilityAdminAction",
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "source" "EligibilityAssessmentSource" NOT NULL DEFAULT 'AUTOMATIC';

-- AddForeignKey
ALTER TABLE "EligibilityAssessment" ADD CONSTRAINT "EligibilityAssessment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
