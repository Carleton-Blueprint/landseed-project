-- AlterEnum
-- NOTE: the in-review feat/live-accessibility-image-generation branch independently
-- adds this same enum value (see its 20260714120000_add_photo_generation_fields
-- migration). Whichever branch merges second must drop this migration file and
-- rely on the one that landed first — do not apply both to the same database.
ALTER TYPE "AuditEventCategory" ADD VALUE 'AI_GENERATION';
