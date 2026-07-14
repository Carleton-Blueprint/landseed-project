import { cleanupExpiredManualFallbackExports } from "@/backend/services/manualFallbackExport";

const SCAN_INTERVAL_MS = Number(process.env.MANUAL_FALLBACK_EXPORT_CLEANUP_INTERVAL_MS ?? 15 * 60 * 1000);

let isCleanupRunning = false;
let cleanupTimer: NodeJS.Timeout | null = null;

async function runCleanup() {
  if (isCleanupRunning) {
    return;
  }

  isCleanupRunning = true;
  try {
    const result = await cleanupExpiredManualFallbackExports();
    console.log("Manual fallback export cleanup completed", {
      scanIntervalMs: SCAN_INTERVAL_MS,
      scanned: result.scanned,
      deleted: result.deleted,
      failed: result.failed,
      exportIds: result.exportIds,
    });
  } catch (error) {
    console.error("Manual fallback export cleanup failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    isCleanupRunning = false;
  }
}

console.log("Manual fallback export cleanup worker started", {
  scanIntervalMs: SCAN_INTERVAL_MS,
});

void runCleanup();
cleanupTimer = setInterval(() => {
  void runCleanup();
}, SCAN_INTERVAL_MS);

async function shutdown() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);