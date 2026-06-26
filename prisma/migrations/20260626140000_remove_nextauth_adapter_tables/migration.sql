-- Drop NextAuth Prisma adapter tables (unused with JWT + Credentials auth).

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_userId_fkey";
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropTable
DROP TABLE "Account";
DROP TABLE "Session";
DROP TABLE "VerificationToken";
