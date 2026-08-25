-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ESTIMATE_READY', 'ESTIMATE_EXPIRED', 'ESTIMATE_ACCEPTED', 'ESTIMATE_DECLINED', 'APPROVED', 'REJECTED', 'WORK_SCHEDULED', 'WORK_IN_PROGRESS', 'WORK_ON_HOLD', 'WORK_COMPLETED', 'WORK_CANCELLED');

-- Collapse Project.status (free-form string) and Project.grantApplicationStatus
-- (GrantApplicationStatus enum) into the single new ProjectStatus enum. An
-- already-decided grant outcome (APPROVED/REJECTED) wins over the old
-- pre-decision status, since a project can only reach that grant outcome
-- after its quote was already accepted; the retired UNDER_REVIEW grant state
-- folds into ESTIMATE_ACCEPTED, since there is no longer a separate
-- "under review" stage once a decision is pending.
ALTER TABLE "Project" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus" USING (
  CASE
    WHEN "grantApplicationStatus" = 'APPROVED' THEN 'APPROVED'
    WHEN "grantApplicationStatus" = 'REJECTED' THEN 'REJECTED'
    WHEN "status" = 'draft' THEN 'DRAFT'
    WHEN "status" = 'submitted' THEN 'SUBMITTED'
    WHEN "status" = 'estimate_ready' THEN 'ESTIMATE_READY'
    WHEN "status" = 'estimate_expired' THEN 'ESTIMATE_EXPIRED'
    WHEN "status" = 'estimate_accepted' THEN 'ESTIMATE_ACCEPTED'
    WHEN "status" = 'estimate_declined' THEN 'ESTIMATE_DECLINED'
    WHEN "status" = 'work_scheduled' THEN 'WORK_SCHEDULED'
    WHEN "status" = 'work_in_progress' THEN 'WORK_IN_PROGRESS'
    WHEN "status" = 'work_on_hold' THEN 'WORK_ON_HOLD'
    WHEN "status" = 'work_completed' THEN 'WORK_COMPLETED'
    WHEN "status" = 'work_cancelled' THEN 'WORK_CANCELLED'
    ELSE 'DRAFT'
  END
)::"ProjectStatus";

ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "grantApplicationStatus";

-- RenameTable
ALTER TABLE "GrantApplicationStatusHistory" RENAME TO "ProjectStatusHistory";

-- Drop any history row that becomes a no-op transition (fromStatus = toStatus)
-- once UNDER_REVIEW collapses into ESTIMATE_ACCEPTED below. NULL fromStatus
-- (the initial creation row) never matches, so it is always kept.
DELETE FROM "ProjectStatusHistory"
WHERE (CASE WHEN "fromStatus" = 'UNDER_REVIEW' THEN 'ESTIMATE_ACCEPTED' ELSE "fromStatus"::TEXT END)
    = (CASE WHEN "toStatus" = 'UNDER_REVIEW' THEN 'ESTIMATE_ACCEPTED' ELSE "toStatus"::TEXT END);

-- AlterTable
ALTER TABLE "ProjectStatusHistory" ALTER COLUMN "fromStatus" TYPE "ProjectStatus" USING (
  CASE WHEN "fromStatus" = 'UNDER_REVIEW' THEN 'ESTIMATE_ACCEPTED' ELSE "fromStatus"::TEXT END
)::"ProjectStatus";

ALTER TABLE "ProjectStatusHistory" ALTER COLUMN "toStatus" TYPE "ProjectStatus" USING (
  CASE WHEN "toStatus" = 'UNDER_REVIEW' THEN 'ESTIMATE_ACCEPTED' ELSE "toStatus"::TEXT END
)::"ProjectStatus";

DROP TYPE "GrantApplicationStatus";

-- RenameConstraints/Indexes to match the renamed table
ALTER TABLE "ProjectStatusHistory" RENAME CONSTRAINT "GrantApplicationStatusHistory_pkey" TO "ProjectStatusHistory_pkey";
ALTER TABLE "ProjectStatusHistory" RENAME CONSTRAINT "GrantApplicationStatusHistory_projectId_fkey" TO "ProjectStatusHistory_projectId_fkey";
ALTER TABLE "ProjectStatusHistory" RENAME CONSTRAINT "GrantApplicationStatusHistory_changedByUserId_fkey" TO "ProjectStatusHistory_changedByUserId_fkey";

ALTER INDEX "GrantApplicationStatusHistory_projectId_changedAt_idx" RENAME TO "ProjectStatusHistory_projectId_changedAt_idx";
ALTER INDEX "GrantApplicationStatusHistory_changedByUserId_changedAt_idx" RENAME TO "ProjectStatusHistory_changedByUserId_changedAt_idx";
