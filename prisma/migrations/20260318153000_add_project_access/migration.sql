-- Add multi-user access control for shared client/project accounts.
-- Non-destructive migration: existing ownership stays in Project.userId.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProjectAccessRole') THEN
    CREATE TYPE "ProjectAccessRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ProjectAccess" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ProjectAccessRole" NOT NULL DEFAULT 'VIEWER',
  "grantedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectAccess_projectId_userId_key" ON "ProjectAccess"("projectId", "userId");
CREATE INDEX IF NOT EXISTS "ProjectAccess_projectId_idx" ON "ProjectAccess"("projectId");
CREATE INDEX IF NOT EXISTS "ProjectAccess_userId_idx" ON "ProjectAccess"("userId");
CREATE INDEX IF NOT EXISTS "ProjectAccess_grantedByUserId_idx" ON "ProjectAccess"("grantedByUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ProjectAccess_projectId_fkey'
  ) THEN
    ALTER TABLE "ProjectAccess"
      ADD CONSTRAINT "ProjectAccess_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ProjectAccess_userId_fkey'
  ) THEN
    ALTER TABLE "ProjectAccess"
      ADD CONSTRAINT "ProjectAccess_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ProjectAccess_grantedByUserId_fkey'
  ) THEN
    ALTER TABLE "ProjectAccess"
      ADD CONSTRAINT "ProjectAccess_grantedByUserId_fkey"
      FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill each current owner as OWNER in the new access table.
INSERT INTO "ProjectAccess" ("id", "projectId", "userId", "role", "grantedByUserId", "createdAt", "updatedAt")
SELECT
  CONCAT('pa_', "Project"."id", '_', "Project"."userId"),
  "Project"."id",
  "Project"."userId",
  'OWNER'::"ProjectAccessRole",
  "Project"."userId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Project"
ON CONFLICT ("projectId", "userId") DO UPDATE
SET
  "role" = 'OWNER'::"ProjectAccessRole",
  "grantedByUserId" = EXCLUDED."grantedByUserId",
  "updatedAt" = CURRENT_TIMESTAMP;
