/**
 * Combined worker entry point: starts every BullMQ worker in a single Node
 * process. Each worker module creates and starts its worker on import (side
 * effect), so importing them here is enough to run them all.
 *
 * Used as the Railway start command (npm run worker:all) so one service
 * consumes every queue. Every worker's env vars must be present in that
 * environment (REDIS_URL, RESEND_API_KEY + EMAIL_FROM, R2_* + ClamAV,
 * OPENAI_API_KEY, etc.). To isolate a heavy worker later, run it as its own
 * service via its dedicated npm script instead of importing it here.
 */
import "dotenv/config";

import "./virusScanWorker";
import "./emailWorker";
import "./aiJobsWorker";
import "./builderTrendTransferWorker";
import "./estimateExpiryWorker";
import "./estimateGenerationWorker";
import "./staffRequestFollowUpWorker";
import "./manualReviewWorker";
import "./manualFallbackExportWorker";
import "./manualFallbackExportCleanupWorker";
import "./accountDeletionWorker";
import "./accountDeletionFinalizerWorker";
import "./adminDigestWorker";
import "./grantMatchSummaryWorker";

console.log("\n" + "=".repeat(60));
console.log("🧵 ALL WORKERS STARTED (combined process)");
console.log(`📡 Redis: ${process.env.REDIS_URL ?? "redis://localhost:6379"}`);
console.log("=".repeat(60) + "\n");

// Surface crashes instead of letting a single worker's error die silently and
// take the shared process down without explanation.
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  Unhandled rejection in combined worker process:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("⚠️  Uncaught exception in combined worker process:", error);
});
