-- Track whether the automatic manual-fallback-export has already been triggered
-- for a BuilderTrend transfer that exhausted its retries, so the worker's
-- exhaustion handler can guard against triggering it more than once.
ALTER TABLE "BuilderTrendTransfer" ADD COLUMN "fallbackRequestedAt" TIMESTAMP(3);
