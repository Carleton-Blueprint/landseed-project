/**
 * FR-2.6: Manual Review Worker
 *
 * Processes manual review flag jobs from the manualReviewQueue.
 *
 * Responsibilities:
 * - Upsert ProjectManualReviewFlag by projectId (idempotency)
 * - Stale evaluation guard: ignore if project has newer assessment
 * - Audit events on create/update
 * - Retry policy: 3 attempts with exponential backoff (1s/2s/4s)
 * - Dead-letter queue fallback on terminal failure
 */

import { createManualReviewWorker } from '@/backend/queue';
import { prisma } from 'lib/prisma';
import { ProjectManualReviewReasonCode } from '@prisma/client';

const worker = createManualReviewWorker(async (job) => {
  const { projectId, assessmentId, aiConfidence, complexityScore, reason } = job.data;

  // Step 1: Validate project exists
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Step 2: Stale evaluation guard
  // Ignore this job if the project has a newer assessment than the one triggering this flag
  const latestAssessment = await prisma.eligibilityAssessment.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });

  if (latestAssessment && latestAssessment.id !== assessmentId) {
    console.log(
      `[ManualReview] Stale evaluation guard: ignoring job for assessment ${assessmentId} ` +
        `(newer assessment exists: ${latestAssessment.id})`
    );
    return;
  }

  // Step 3: Determine reason enum value
  const reasonCode = reason as ProjectManualReviewReasonCode;

  // Step 4: Build description for audit trail
  const description = buildFlagDescription(reasonCode, aiConfidence, complexityScore);

  // Step 5: Upsert ProjectManualReviewFlag
  const existingFlag = await prisma.projectManualReviewFlag.findUnique({
    where: { projectId },
  });

  if (existingFlag) {
    const flag = await prisma.projectManualReviewFlag.update({
      where: { projectId },
      data: {
        reason: reasonCode,
        isActive: true,
        lastEvaluatedAt: new Date(),
        lastEvaluationEligibilityAssessmentId: assessmentId,
        description,
      },
    });

    await createAuditEvent({
      action: 'MANUAL_REVIEW_FLAG_UPDATED',
      flagId: flag.id,
      projectId,
      assessmentId,
      reason: reasonCode,
      description,
    });

    console.log(`[ManualReview] Updated flag for project ${projectId} (reason: ${reasonCode})`);
  } else {
    const flag = await prisma.projectManualReviewFlag.create({
      data: {
        projectId,
        reason: reasonCode,
        isActive: true,
        lastEvaluatedAt: new Date(),
        lastEvaluationEligibilityAssessmentId: assessmentId,
        description,
      },
    });

    await createAuditEvent({
      action: 'MANUAL_REVIEW_FLAG_CREATED',
      flagId: flag.id,
      projectId,
      assessmentId,
      reason: reasonCode,
      description,
    });

    console.log(`[ManualReview] Created flag for project ${projectId} (reason: ${reasonCode})`);
  }
});

// Event listeners
worker.on('completed', (job) => {
  console.log(`[ManualReview] Job completed for project ${job.data.projectId} (job ID: ${job.id})`);
});

worker.on('failed', (job, err) => {
  console.error(
    `[ManualReview] Job failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}) ` +
      `for project ${job?.data.projectId}: ${err.message}`
  );
});

worker.on('error', (err) => {
  console.error('[ManualReview] Worker error:', err);
});

/**
 * Helper: Build human-readable description for flag
 */
function buildFlagDescription(
  reason: ProjectManualReviewReasonCode,
  aiConfidence: string,
  complexityScore?: number
): string {
  const parts: string[] = [];

  if (reason === 'LOW_CONFIDENCE') {
    parts.push('AI confidence is LOW');
  } else if (reason === 'HIGH_COMPLEXITY') {
    parts.push(`Project complexity is HIGH (${complexityScore ?? 0} signals detected)`);
  } else if (reason === 'BOTH') {
    parts.push('LOW AI confidence + HIGH complexity');
  }

  parts.push(`AI confidence level: ${aiConfidence}`);

  return parts.join('; ');
}

/**
 * Helper: Create audit event for manual review operations
 */
async function createAuditEvent({
  action,
  flagId,
  projectId,
  assessmentId,
  reason,
  description,
}: {
  action: string;
  flagId: string;
  projectId: string;
  assessmentId?: string;
  reason: ProjectManualReviewReasonCode;
  description: string;
}): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        category: 'MANUAL_CHANGE',
        action,
        outcome: 'SUCCESS',
        resourceType: 'ProjectManualReviewFlag',
        resourceId: flagId,
        projectId,
        description,
        metadata: {
          ...(assessmentId ? { assessmentId } : {}),
          reason,
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    console.warn(`[ManualReview] Failed to create audit event for ${action}:`, error);
    // Audit creation failure should not block the main operation
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[ManualReview] SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[ManualReview] SIGINT received, closing worker...');
  await worker.close();
  process.exit(0);
});

console.log('[ManualReview] Worker started and listening on queue: manual-review');