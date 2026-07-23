/**
 * ai-jobs queue worker.
 *
 * Single consumer for the shared "ai-jobs" BullMQ queue, dispatching by
 * job.data.jobType. A second worker process also listening on "ai-jobs"
 * would race this one for jobs it doesn't recognize (BullMQ delivers each
 * job to exactly one consumer, and an unrecognized jobType is just logged
 * and dropped) — so new job types belong here as additional switch cases,
 * not as separate worker processes on the same queue.
 *
 * How to run:
 *   npm run worker:ai-jobs
 */
import "dotenv/config";
import { createAiJobsWorker } from "@/backend/queue";
import {
  PHOTO_MODIFICATION_ANALYSIS_JOB_TYPE,
  processPhotoModificationAnalysisJob,
  type PhotoModificationAnalysisJobPayload,
} from "@/backend/services/photoAnalysis";
import {
  ACCESSIBILITY_IMAGE_GENERATION_JOB_TYPE,
  processAccessibilityImageGenerationJob,
  type AccessibilityImageGenerationJobPayload,
} from "@/backend/services/imageGeneration";

const worker = createAiJobsWorker(async (job) => {
  switch (job.data.jobType) {
    case PHOTO_MODIFICATION_ANALYSIS_JOB_TYPE: {
      const payload = job.data.payload as PhotoModificationAnalysisJobPayload;
      await processPhotoModificationAnalysisJob(payload);
      console.log("Photo modification analysis job processed", { photoId: payload.photoId });
      break;
    }
    case ACCESSIBILITY_IMAGE_GENERATION_JOB_TYPE: {
      const payload = job.data.payload as AccessibilityImageGenerationJobPayload;
      await processAccessibilityImageGenerationJob(payload);
      console.log("Accessibility image generation job processed", { photoId: payload.photoId });
      break;
    }
    default:
      console.log("Ignoring unrecognized ai-jobs job type", { jobType: job.data.jobType });
  }
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
