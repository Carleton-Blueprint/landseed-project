import { createBuilderTrendTransferWorker } from "@/backend/queue";
import {
  processBuilderTrendTransfer,
  triggerManualFallbackForExhaustedTransfer,
} from "@/backend/integrations/buildertrend";

const worker = createBuilderTrendTransferWorker(async (job) => {
  await processBuilderTrendTransfer(job.data.transferId, {
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? 3,
  });
});

worker.on("completed", (job) => {
  console.log("BuilderTrend transfer job completed", {
    jobId: job.id,
    transferId: job.data.transferId,
    attemptsMade: job.attemptsMade,
  });
});

worker.on("failed", (job, err) => {
  console.error("BuilderTrend transfer job failed", {
    jobId: job?.id,
    transferId: job?.data.transferId,
    attemptsMade: job?.attemptsMade,
    message: err.message,
  });

  const maxAttempts = job?.opts.attempts ?? 3;
  if (job && job.attemptsMade >= maxAttempts) {
    void triggerManualFallbackForExhaustedTransfer(job.data.transferId).catch((fallbackError) => {
      console.error("Failed to trigger manual fallback export after BuilderTrend retries exhausted", {
        transferId: job.data.transferId,
        message: fallbackError instanceof Error ? fallbackError.message : "Unknown error",
      });
    });
  }
});

worker.on("error", (err) => {
  console.error("BuilderTrend transfer worker error:", err);
});

console.log("BuilderTrend transfer worker started and listening on queue: buildertrend-transfer");

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
