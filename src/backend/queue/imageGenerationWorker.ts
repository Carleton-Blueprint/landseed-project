import { createAiJobsWorker } from "@/backend/queue";
import {
  ACCESSIBILITY_IMAGE_GENERATION_JOB_TYPE,
  processAccessibilityImageGenerationJob,
  type AccessibilityImageGenerationJobPayload,
} from "@/backend/services/imageGeneration";

const worker = createAiJobsWorker(async (job) => {
  if (job.data.jobType !== ACCESSIBILITY_IMAGE_GENERATION_JOB_TYPE) {
    console.log("Ignoring unrecognized ai-jobs job type", { jobType: job.data.jobType });
    return;
  }

  const payload = job.data.payload as AccessibilityImageGenerationJobPayload;
  await processAccessibilityImageGenerationJob(payload);

  console.log("Accessibility image generation job processed", { photoId: payload.photoId });
});

worker.on("completed", (job) => {
  console.log("AI job completed", { jobId: job.id, jobType: job.data.jobType });
});

worker.on("failed", (job, err) => {
  console.error("AI job failed", {
    jobId: job?.id,
    jobType: job?.data.jobType,
    attemptsMade: job?.attemptsMade,
    message: err.message,
  });
});

worker.on("error", (err) => {
  console.error("AI jobs worker error:", err);
});

console.log("AI jobs worker started and listening on queue: ai-jobs");

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
