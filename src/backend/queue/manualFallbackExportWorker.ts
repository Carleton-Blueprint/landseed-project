import { createManualFallbackExportWorker } from "@/backend/queue";
import { processManualFallbackExport } from "@/backend/services/manualFallbackExport";

const worker = createManualFallbackExportWorker(async (job) => {
  await processManualFallbackExport(job.data);
});

worker.on("completed", (job) => {
  console.log("Manual fallback export job completed", {
    jobId: job.id,
    exportRequestId: job.data.exportRequestId,
    attemptsMade: job.attemptsMade,
  });
});

worker.on("failed", (job, err) => {
  console.error("Manual fallback export job failed", {
    jobId: job?.id,
    exportRequestId: job?.data.exportRequestId,
    attemptsMade: job?.attemptsMade,
    message: err.message,
  });
});

worker.on("error", (err) => {
  console.error("Manual fallback export worker error:", err);
});

console.log("Manual fallback export worker started and listening on queue: manual-fallback-export");

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});