ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "estimateMin" numeric(10,2);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "estimateMax" numeric(10,2);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "refinedEstimate" jsonb;
