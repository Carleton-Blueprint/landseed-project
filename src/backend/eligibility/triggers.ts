/**
 * FR-3.1 Automatic Evaluation Triggers
 *
 * Evaluates eligibility automatically via queueEligibilityEvaluation, called
 * after estimate generation completes (or fails) and after a pre-estimate
 * modification override.
 *
 * Safeguards (an admin's result takes precedence over an automatic run):
 * - Skips if the latest quote has a post-estimate QuoteOverride. Defensive:
 *   automatic runs can't currently fire after submission, but a new isLatest
 *   assessment would detach the override's grantId references.
 * - Skips if an ADMIN assessment exists within ELIGIBILITY_ADMIN_GRACE_HOURS.
 * - Skips if the latest assessment is AUTOMATIC and under 30 seconds old
 *   (debounce).
 * - Non-blocking: failures logged but don't block main operation
 */

import { evaluateProjectEligibility } from './service';
import { prisma } from 'lib/prisma';

const PROJECT_WITH_PHOTOS_INCLUDE = {
  photos: { select: { declaredModificationCodes: true } },
} as const;

const AUTOMATIC_DEBOUNCE_SECONDS = 30;

export const ELIGIBILITY_ADMIN_GRACE_HOURS_ENV = 'ELIGIBILITY_ADMIN_GRACE_HOURS';
export const DEFAULT_ELIGIBILITY_ADMIN_GRACE_HOURS = 12;

function parsePositiveIntegerEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export function getAdminGraceHours(): number {
  return (
    parsePositiveIntegerEnv(process.env[ELIGIBILITY_ADMIN_GRACE_HOURS_ENV]) ??
    DEFAULT_ELIGIBILITY_ADMIN_GRACE_HOURS
  );
}

export interface QueueEligibilityEvaluationOptions {
  /**
   * Admin user id when re-running after a pre-estimate modification override.
   * Skips the grace window and debounce (the admin changed the inputs), and
   * saves the assessment as ADMIN / PRE_ESTIMATE_OVERRIDE.
   */
  preEstimateOverrideBy?: string;
}

type EvaluateNowDecision = { evaluate: true } | { evaluate: false; reason: string };

/**
 * Decide whether an evaluation should run now
 */
async function shouldEvaluateNow(
  projectId: string,
  options: QueueEligibilityEvaluationOptions
): Promise<EvaluateNowDecision> {
  const latestQuote = await prisma.quote.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: { override: { select: { id: true } } },
  });

  if (latestQuote?.override) {
    return { evaluate: false, reason: 'latest quote has a post-estimate override' };
  }

  if (options.preEstimateOverrideBy) {
    return { evaluate: true };
  }

  const graceHours = getAdminGraceHours();
  const recentAdminAssessment = await prisma.eligibilityAssessment.findFirst({
    where: {
      projectId,
      source: 'ADMIN',
      createdAt: { gte: new Date(Date.now() - graceHours * 60 * 60 * 1000) },
    },
    select: { id: true },
  });

  if (recentAdminAssessment) {
    return { evaluate: false, reason: `admin assessment within the last ${graceHours}h` };
  }

  const lastAssessment = await prisma.eligibilityAssessment.findFirst({
    where: { projectId, isLatest: true },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, source: true },
  });

  if (lastAssessment?.source === 'AUTOMATIC') {
    const secondsSinceLastEval = (Date.now() - lastAssessment.createdAt.getTime()) / 1000;
    if (secondsSinceLastEval < AUTOMATIC_DEBOUNCE_SECONDS) {
      return { evaluate: false, reason: 'automatic assessment within the last 30s' };
    }
  }

  return { evaluate: true };
}

/**
 * Manually queue evaluation if needed (idempotent)
 * Use in scenarios where automatic triggers don't/can't apply
 */
export async function queueEligibilityEvaluation(
  projectId: string,
  options: QueueEligibilityEvaluationOptions = {}
): Promise<void> {
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

      const decision = await shouldEvaluateNow(projectId, options);
      if (!decision.evaluate) {
        console.log(`Eligibility evaluation skipped for project ${projectId}: ${decision.reason}`);
        return;
      }

      if (options.preEstimateOverrideBy) {
        await evaluateProjectEligibility(
          project,
          { id: options.preEstimateOverrideBy },
          { adminAction: 'PRE_ESTIMATE_OVERRIDE' }
        );
      } else {
        await evaluateProjectEligibility(project);
      }
      console.log(`Queued eligibility evaluation for project ${projectId}`);
    } catch (error) {
      console.warn(`Failed to queue eligibility evaluation:`, error);
    }
  });
}
