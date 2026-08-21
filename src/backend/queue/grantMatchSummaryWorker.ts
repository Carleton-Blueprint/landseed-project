import "dotenv/config";
import { createGrantMatchSummaryWorker } from "@/backend/queue";
import { generateAndStoreGrantMatchSummaryDocument } from "@/backend/services/grantMatchSummaryDocument";

const worker = createGrantMatchSummaryWorker(async (job) => {
  await generateAndStoreGrantMatchSummaryDocument(job.data);
});

worker.on("completed", (job) => {
  console.log("Grant match summary job completed", {
    jobId: job.id,
    projectId: job.data.projectId,
    attemptsMade: job.attemptsMade,
  });
});

worker.on("failed", (job, err) => {
  console.error("Grant match summary job failed", {
    jobId: job?.id,
    projectId: job?.data.projectId,
    attemptsMade: job?.attemptsMade,
    message: err.message,
  });
});

worker.on("error", (err) => {
  console.error("Grant match summary worker error:", err);
});

console.log("Grant match summary worker started and listening on queue: grant-match-summary");

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
