import { expireInactiveQuotes } from "@/backend/services/quoteExpiration";

const SCAN_INTERVAL_MS = Number(process.env.ESTIMATE_EXPIRY_SCAN_INTERVAL_MS ?? 15 * 60 * 1000); // default 15 mins
const INACTIVITY_DAYS = Number(process.env.ESTIMATE_EXPIRY_INACTIVITY_DAYS ?? 30); // default 30 days
const BATCH_SIZE = Number(process.env.ESTIMATE_EXPIRY_BATCH_SIZE ?? 200); // default 200 quotes (limits how many quotes are considered for sweeping in each interval - if there are more stale quotes than this, multiple sweeps will occur over time until all are processed)

let isSweepRunning = false;
let sweepTimer: NodeJS.Timeout | null = null;

async function runSweep() {
  if (isSweepRunning) {
    return;
  }

  isSweepRunning = true;
  try {
    const result = await expireInactiveQuotes({
      inactivityDays: INACTIVITY_DAYS,
      batchSize: BATCH_SIZE,
    });

    console.log("Estimate expiry sweep completed", {
      inactivityDays: INACTIVITY_DAYS,
      cutoffAt: result.cutoffAt.toISOString(),
      scanned: result.scanned,
      expired: result.expired,
      batches: result.batches,
    });
  } catch (error) {
    console.error("Estimate expiry sweep failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    isSweepRunning = false;
  }
}

console.log("Estimate expiry worker started", {
  scanIntervalMs: SCAN_INTERVAL_MS,
  inactivityDays: INACTIVITY_DAYS,
  batchSize: BATCH_SIZE,
});

void runSweep();
sweepTimer = setInterval(() => {
  void runSweep(); // run expiry checks/sweeps every SCAN_INTERVAL_MS
}, SCAN_INTERVAL_MS);

async function shutdown() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);