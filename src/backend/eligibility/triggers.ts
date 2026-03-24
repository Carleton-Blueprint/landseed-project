/**
 * FR-3.1 Automatic Evaluation Triggers
 * 
 * Evaluates eligibility automatically when:
 * - Project is created or updated
 * - Draft data changes
 * 
 * Safeguards:
 * - Only evaluates if 30+ seconds since last evaluation (rate limiting)
 * - Only evaluates if significant data change detected
 * - Non-blocking: failures logged but don't block main operation
 */

import { Project } from '@prisma/client';
import { evaluateProjectEligibility } from './service';
import prisma from 'lib/prisma';

const EVALUATION_COOLDOWN_SECONDS = 30;

/**
 * Detect if draft data has significantly changed
 */
function hasDraftDataChanged(oldDraft: any, newDraft: any): boolean {
  if (!oldDraft && !newDraft) return false;
  if (!oldDraft || !newDraft) return true;

  // Check key fields that matter for eligibility
  const relevantFields = [
    'province',
    'ownershipStatus',
    'clientConsentConfirmed',
    'modificationItems',
    'estimatedHouseholdIncome',
    'age',
    'propertyYearBuilt',
  ];

  for (const field of relevantFields) {
    if (JSON.stringify(oldDraft[field]) !== JSON.stringify(newDraft[field])) {
      return true;
    }
  }

  return false;
}

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
 * Trigger eligibility evaluation after project creation
 * Non-blocking: returns immediately, evaluation happens in background
 */
export async function triggerEvaluationAfterProjectCreation(project: Project): Promise<void> {
  // Schedule async evaluation in background
  setImmediate(async () => {
    try {
      const shouldEval = await shouldEvaluateNow(project.id);
      if (!shouldEval) {
        console.log(`Eligibility evaluation rate-limited for project ${project.id}`);
        return;
      }

      await evaluateProjectEligibility(project);
      console.log(`Auto-evaluated eligibility for new project ${project.id}`);
    } catch (error) {
      console.warn(`Failed to auto-evaluate eligibility after project creation:`, error);
    }
  });
}

/**
 * Trigger eligibility re-evaluation after draft data update
 * Only if significant fields changed
 */
export async function triggerEvaluationAfterDraftUpdate(
  project: Project,
  oldDraft: any,
  newDraft: any
): Promise<void> {
  // Check if evaluation is needed
  if (!hasDraftDataChanged(oldDraft, newDraft)) {
    return; // No relevant changes
  }

  setImmediate(async () => {
    try {
      const shouldEval = await shouldEvaluateNow(project.id);
      if (!shouldEval) {
        console.log(`Eligibility re-evaluation rate-limited for project ${project.id}`);
        return;
      }

      // Refresh project with updated draftData
      const updatedProject = await prisma.project.findUnique({
        where: { id: project.id },
      });

      if (updatedProject) {
        await evaluateProjectEligibility(updatedProject);
        console.log(`Auto-re-evaluated eligibility for project ${project.id} (draft update)`);
      }
    } catch (error) {
      console.warn(`Failed to auto-evaluate eligibility after draft update:`, error);
    }
  });
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
      });

      if (!project) {
        console.warn(`Project ${projectId} not found for evaluation`);
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
