/**
 * FR-3.1 Automatic Evaluation Triggers
 *
 * Evaluates eligibility automatically via queueEligibilityEvaluation, called
 * after estimate generation completes (or fails) and after a pre-estimate
 * modification override.
 *
 * Safeguards:
 * - Only evaluates if 30+ seconds since last evaluation (rate limiting)
 * - Non-blocking: failures logged but don't block main operation
 */

import { evaluateProjectEligibility } from './service';
import { prisma } from 'lib/prisma';

const PROJECT_WITH_PHOTOS_INCLUDE = {
  photos: { select: { declaredModificationCodes: true } },
} as const;

const EVALUATION_COOLDOWN_SECONDS = 30;

/**
 * Check if enough time has passed since last evaluation
 */
async function shouldEvaluateNow(projectId: string): Promise<boolean> {
  const lastAssessment = await prisma.eligibilityAssessment.findFirst({
    where: { projectId, isLatest: true },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (!lastAssessment) {
    return true; // No prior evaluation
  }

  const secondsSinceLastEval = (Date.now() - lastAssessment.createdAt.getTime()) / 1000;
  return secondsSinceLastEval >= EVALUATION_COOLDOWN_SECONDS;
}

/**
 * Manually queue evaluation if needed (idempotent)
 * Use in scenarios where automatic triggers don't/can't apply
 */
export async function queueEligibilityEvaluation(projectId: string): Promise<void> {
  setImmediate(async () => {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: PROJECT_WITH_PHOTOS_INCLUDE,
      });

      if (!project) {
        console.warn(`Project ${projectId} not found for evaluation`);
        return;
      }

      if (project.isManualMode) {
        return;
      }

      const shouldEval = await shouldEvaluateNow(projectId);
      if (!shouldEval) {
        console.log(`Eligibility evaluation rate-limited for project ${projectId}`);
        return;
      }

      await evaluateProjectEligibility(project);
      console.log(`Queued eligibility evaluation for project ${projectId}`);
    } catch (error) {
      console.warn(`Failed to queue eligibility evaluation:`, error);
    }
  });
}
