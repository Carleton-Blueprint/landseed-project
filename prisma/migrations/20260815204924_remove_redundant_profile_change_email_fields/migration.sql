-- Removes the redundant EMAIL_CHANGE_CURRENT/EMAIL_CHANGE_NEW token purposes
-- and User.pendingEmail column added in 20260815202438. That migration
-- shipped a parallel, less complete reimplementation of the email-change
-- flow already covered by EMAIL_CHANGE_OLD_CONFIRM/EMAIL_CHANGE_NEW_CONFIRM
-- (AuthEmailToken.newEmail stages the pending address instead of a column
-- on User). No rows use the values being removed.

-- AlterEnum
BEGIN;
CREATE TYPE "AuthEmailTokenPurpose_new" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMAIL_CHANGE_OLD_CONFIRM', 'EMAIL_CHANGE_NEW_CONFIRM');
ALTER TABLE "AuthEmailToken" ALTER COLUMN "purpose" TYPE "AuthEmailTokenPurpose_new" USING ("purpose"::text::"AuthEmailTokenPurpose_new");
ALTER TYPE "AuthEmailTokenPurpose" RENAME TO "AuthEmailTokenPurpose_old";
ALTER TYPE "AuthEmailTokenPurpose_new" RENAME TO "AuthEmailTokenPurpose";
DROP TYPE "AuthEmailTokenPurpose_old";
COMMIT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "pendingEmail";
