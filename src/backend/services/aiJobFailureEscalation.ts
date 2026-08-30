/**
 * Escalation path for ai-jobs queue jobs (photo modification analysis,
 * accessibility image generation) that exhaust all retry attempts: the
 * ai-jobs worker previously only logged on final failure with no downstream
 * effect, so a project could silently end up with no AI-generated
 * visual/analysis and nobody flagged to follow up manually.
 */
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { manualReviewQueue } from "@/backend/queue";

export interface AiJobFailureEscalationInput {
  jobType: string;
  photoId: string;
  errorMessage: string;
  attemptsMade: number;
  maxAttempts: number;
}

/**
 * Flags the photo's project for manual review after an ai-jobs job has
 * exhausted all retry attempts. Idempotent per (jobType, photoId) via the
 * BullMQ jobId, same as the existing photo-mismatch manual review trigger
 * in photoAnalysis.ts.
 */
export async function flagAiJobFailureForManualReview(
  input: AiJobFailureEscalationInput
): Promise<void> {
  const photo = await prisma.photo.findUnique({
    where: { id: input.photoId },
    select: { id: true, projectId: true },
  });

  if (!photo) {
    return;
  }

  await manualReviewQueue.add(
    "manual-review",
    {
      projectId: photo.projectId,
      reason: "AI_JOB_RETRIES_EXHAUSTED",
      aiConfidence: "LOW",
      photoId: photo.id,
      metadata: {
        jobType: input.jobType,
        errorMessage: input.errorMessage,
        attemptsMade: input.attemptsMade,
        maxAttempts: input.maxAttempts,
      },
    },
    {
      jobId: `manual-review-ai-job-failure-${input.jobType}-${photo.id}`,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    }
  );

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "AI_JOB_MANUAL_REVIEW_FLAGGED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    projectId: photo.projectId,
    resourceType: "ai_job",
    resourceId: photo.id,
    description: `AI job (${input.jobType}) exhausted all retry attempts; project flagged for manual review`,
    metadata: {
      jobType: input.jobType,
      photoId: photo.id,
      attemptsMade: input.attemptsMade,
      maxAttempts: input.maxAttempts,
      errorMessage: input.errorMessage,
      triggeredBy: "system:ai-job-retries-exhausted",
    },
  });
}
