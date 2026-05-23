-- Add tamper-evident columns for AuditEvent
ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "eventHash" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "prevHash" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "signature" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMP;
ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "signedBy" TEXT;

-- Optional: set default nulls (Postgres does this implicitly). Indexes can be added later if needed.