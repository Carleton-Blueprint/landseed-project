-- CreateEnum
CREATE TYPE "AuthEmailTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "AuthEmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AuthEmailTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEmailToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthEmailToken_userId_purpose_idx" ON "AuthEmailToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AuthEmailToken_tokenHash_idx" ON "AuthEmailToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "AuthEmailToken" ADD CONSTRAINT "AuthEmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
