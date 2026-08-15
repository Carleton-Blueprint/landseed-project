import "dotenv/config";
import { flagStaleInformationRequests } from "@/backend/services/informationRequestFollowUp";

const SCAN_INTERVAL_MS = Number(process.env.STAFF_REQUEST_FOLLOWUP_SCAN_INTERVAL_MS ?? 15 * 60 * 1000); // default 15 mins
const FOLLOW_UP_DAYS = Number(process.env.STAFF_REQUEST_FOLLOWUP_DAYS ?? 7); // default 7 days
const BATCH_SIZE = Number(process.env.STAFF_REQUEST_FOLLOWUP_BATCH_SIZE ?? 200);

let isSweepRunning = false;
let sweepTimer: NodeJS.Timeout | null = null;

async function runSweep() {
  if (isSweepRunning) {
    return;
  }

  isSweepRunning = true;
  try {
    const result = await flagStaleInformationRequests({
      followUpDays: FOLLOW_UP_DAYS,
      batchSize: BATCH_SIZE,
    });

    console.log("Staff information request follow-up sweep completed", {
      followUpDays: FOLLOW_UP_DAYS,
      cutoffAt: result.cutoffAt.toISOString(),
      scanned: result.scanned,
      flagged: result.flagged,
      batches: result.batches,
    });
  } catch (error) {
    console.error("Staff information request follow-up sweep failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    isSweepRunning = false;
  }
}

console.log("Staff request follow-up worker started", {
  scanIntervalMs: SCAN_INTERVAL_MS,
  followUpDays: FOLLOW_UP_DAYS,
  batchSize: BATCH_SIZE,
});

void runSweep();
sweepTimer = setInterval(() => {
  void runSweep();
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
