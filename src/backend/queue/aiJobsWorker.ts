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
import { registerShutdownHandler } from "@/backend/queue/shutdownRegistry";
import {
  PHOTO_MODIFICATION_ANALYSIS_JOB_TYPE,
  processPhotoModificationAnalysisJob,
  type PhotoModificationAnalysisJobPayload,
} from "@/backend/services/photoAnalysis";
import {
  ACCESSIBILITY_IMAGE_GENERATION_JOB_TYPE,
  processAccessibilityImageGenerationJob,
  applyAccessibilityVisualMockFallback,
  type AccessibilityImageGenerationJobPayload,
} from "@/backend/services/imageGeneration";
import { recordFailureAndMaybeAlert } from "@/backend/services/criticalFailureAlerts";
import { ALERT_THRESHOLD_KEYS } from "@/backend/services/alertThresholds";
import { flagAiJobFailureForManualReview } from "@/backend/services/aiJobFailureEscalation";

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

  const maxAttempts = job?.opts.attempts ?? 3;
  const photoId = (job?.data.payload as { photoId?: string } | undefined)?.photoId;
  if (job && job.attemptsMade >= maxAttempts) {
    void recordFailureAndMaybeAlert({
      key: ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE,
      summary: `AI job failed after ${job.attemptsMade} attempts (jobType: ${job.data.jobType})`,
      details: { jobId: job.id, jobType: job.data.jobType, errorMessage: err.message },
    });

    if (job.data.jobType === ACCESSIBILITY_IMAGE_GENERATION_JOB_TYPE) {
      const payload = job.data.payload as AccessibilityImageGenerationJobPayload;
      void applyAccessibilityVisualMockFallback(payload.photoId, err.message);
    }

    if (photoId) {
      void flagAiJobFailureForManualReview({
        jobType: job.data.jobType,
        photoId,
        errorMessage: err.message,
        attemptsMade: job.attemptsMade,
        maxAttempts,
      }).catch((escalationError) => {
        console.error("Failed to flag AI job for manual review after retries exhausted", {
          jobId: job.id,
          jobType: job.data.jobType,
          photoId,
          message: escalationError instanceof Error ? escalationError.message : "Unknown error",
        });
      });
    }
  }
});

worker.on("error", (err) => {
  console.error("AI jobs worker error:", err);
});

console.log("AI jobs worker started and listening on queue: ai-jobs");

registerShutdownHandler("ai-jobs", async () => {
  await worker.close();
});
