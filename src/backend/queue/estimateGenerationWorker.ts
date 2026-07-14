import { createEstimateGenerationWorker } from "@/backend/queue";
import { processScheduledEstimateGeneration } from "@/backend/services/estimateGeneration";

const worker = createEstimateGenerationWorker(async (job) => {
  const result = await processScheduledEstimateGeneration(job.data);

  console.log("Estimate generation job processed", {
    projectId: result.projectId,
    status: result.status,
    quoteId: result.quoteId,
  });
});

worker.on("completed", (job) => {
  console.log("Estimate generation job completed", {
    jobId: job.id,
    projectId: job.data.projectId,
    attemptsMade: job.attemptsMade,
  });
});

worker.on("failed", (job, err) => {
  console.error("Estimate generation job failed", {
    jobId: job?.id,
    projectId: job?.data.projectId,
    attemptsMade: job?.attemptsMade,
    message: err.message,
  });
});

worker.on("error", (err) => {
  console.error("Estimate generation worker error:", err);
});

console.log("Estimate generation worker started and listening on queue: estimate-generation");

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
