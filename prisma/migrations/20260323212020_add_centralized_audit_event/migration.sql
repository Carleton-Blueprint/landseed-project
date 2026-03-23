-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "declinedReason" TEXT,
ADD COLUMN     "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING';
