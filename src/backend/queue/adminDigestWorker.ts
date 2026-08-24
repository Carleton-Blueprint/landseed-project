/**
 * Admin daily digest worker: sends a summary of the last 24h of
 * SecurityEvent rows (rate-limit hits + alert triggers) to every ADMIN
 * user once a day. On startup, checks whether a
 * scheduled send was missed while the worker was down (AdminDigestRun
 * table) and if so sends one catch-up summary covering the gap before
 * resuming the normal schedule — see runCatchUpIfNeeded.
 *
 * Not a BullMQ queue/worker — this repo already has a precedent for
 * time-based recurring jobs that isn't BullMQ (estimateExpiryWorker.ts's
 * setInterval sweep), so this follows that shape instead of introducing a
 * second, inconsistent scheduling mechanism. Unlike that sweep (which
 * tolerates running at any cadence within its interval), a digest should
 * land at a fixed time daily, so this computes ms-until-next-occurrence
 * and reschedules itself with setTimeout after each run.
 *
 * How to run:
 *   npm run worker:admin-digest
 */
import "dotenv/config";
import { sendDailyDigest, runCatchUpIfNeeded } from "@/backend/services/adminDigest";

const DIGEST_HOUR_UTC = Number(process.env.ADMIN_DIGEST_HOUR_UTC ?? 13); // default 13:00 UTC

let digestTimer: NodeJS.Timeout | null = null;

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC, 0, 0, 0)
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runDigest() {
  try {
    await sendDailyDigest();
    console.log("Admin daily digest sent", { at: new Date().toISOString() });
  } catch (error) {
    console.error("Admin daily digest run failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function scheduleNext() {
  const delay = msUntilNextRun();
  console.log("Next admin daily digest scheduled", {
    inMs: delay,
    at: new Date(Date.now() + delay).toISOString(),
  });
  digestTimer = setTimeout(() => {
    void runDigest().then(() => {
      // Recompute against the UTC-hour target rather than a fixed +24h
      // offset, so a slow run doesn't compound drift over time.
      scheduleNext();
    });
  }, delay);
}

console.log("Admin digest worker started", { digestHourUtc: DIGEST_HOUR_UTC });
void runCatchUpIfNeeded(DIGEST_HOUR_UTC).then((result) => {
  if (result.sent) {
    console.log("Sent catch-up digest for a missed run");
  }
  scheduleNext();
});

async function shutdown() {
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = null;
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
