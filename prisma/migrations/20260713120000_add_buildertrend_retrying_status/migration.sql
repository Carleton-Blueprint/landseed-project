-- Add intermediate "RETRYING" state so a BuilderTrend transfer that still has
-- retry attempts left is distinguishable from one that has exhausted retries.
ALTER TYPE "BuilderTrendTransferStatus" ADD VALUE 'RETRYING';
