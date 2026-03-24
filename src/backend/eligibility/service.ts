/**
 * FR-3.1 Eligibility Service
 * 
 * Orchestrates the eligibility evaluation workflow:
 * 1. Assemble EligibilityInput from Project + draftData
 * 2. Evaluate using active grant rules version
 * 3. Persist EligibilityAssessment snapshot
 * 4. Return result with assessment ID
 */

import { Project, User } from '@prisma/client';
import { assembleEligibilityInput } from './assembler';
import { evaluateEligibility, EvaluationResult } from './evaluator';
import { createEligibilityAssessmentSnapshot } from './repository';
import { EligibilityDecision } from './types';
import prisma from 'lib/prisma';

export interface EvaluateEligibilityServiceResult {
  assessmentId: string;
  projectId: string;
  overallDecision: EligibilityDecision;
  programDecisions: Record<string, EligibilityDecision>;
  reasonCodes: string[];
  staffReasonMessages: string[];
  clientReasonMessages: string[];
  missingRequirements: string[];
  grantRulesVersionId: string;
  createdAt: Date;
}

export interface EvaluateEligibilityServiceError {
  code: 'NO_ACTIVE_GRANT_RULES' | 'ASSEMBLY_FAILED' | 'EVALUATION_FAILED' | 'PERSISTENCE_FAILED' | 'UNKNOWN';
  message: string;
  details?: any;
}

/**
 * Main service function: evaluate and persist eligibility assessment
 */
export async function evaluateProjectEligibility(
  project: Project,
  performedBy?: User
): Promise<EvaluateEligibilityServiceResult | EvaluateEligibilityServiceError> {
  try {
    // Step 1: Get active grant rules version
    const activeRules = await prisma.grantRulesVersion.findFirst({
      where: { isActive: true },
      orderBy: { versionNumber: 'desc' },
    });

    if (!activeRules) {
      return {
        code: 'NO_ACTIVE_GRANT_RULES',
        message: 'No active grant rules version found. Cannot evaluate eligibility.',
      };
    }

    // Step 2: Assemble EligibilityInput from project
    const input = assembleEligibilityInput(project);

    // Step 3: Evaluate eligibility
    const evaluation = evaluateEligibility(input, activeRules);

    // Step 4: Persist assessment snapshot
    const assessment = await createEligibilityAssessmentSnapshot({
      projectId: project.id,
      grantRulesVersionId: activeRules.id,
      overallDecision: evaluation.overallDecision,
      programDecisions: evaluation.programDecisions,
      reasonCodes: evaluation.reasonCodes,
      missingRequirements: evaluation.missingRequirements,
    });

    if (!assessment) {
      return {
        code: 'PERSISTENCE_FAILED',
        message: 'Failed to persist eligibility assessment',
      };
    }

    // Step 5: Audit log (if audit event creation is available)
    if (performedBy) {
      try {
        await prisma.auditEvent.create({
          data: {
            category: 'MANUAL_CHANGE',
            action: 'ELIGIBILITY_EVALUATED',
            outcome: 'SUCCESS',
            resourceType: 'EligibilityAssessment',
            resourceId: assessment.id,
            projectId: project.id,
            actorUserId: performedBy.id,
            description: `Eligibility assessment: ${evaluation.overallDecision}`,
            metadata: {
              decision: evaluation.overallDecision,
              reasonCodes: evaluation.reasonCodes,
              grantRulesVersion: activeRules.versionNumber,
            },
          },
        });
      } catch (error) {
        // Audit event creation failure should not block the main operation
        console.warn('Failed to create audit event for eligibility evaluation', error);
      }
    }

    return {
      assessmentId: assessment.id,
      projectId: project.id,
      overallDecision: evaluation.overallDecision,
      programDecisions: evaluation.programDecisions,
      reasonCodes: evaluation.reasonCodes,
      staffReasonMessages: evaluation.staffReasonMessages,
      clientReasonMessages: evaluation.clientReasonMessages,
      missingRequirements: evaluation.missingRequirements,
      grantRulesVersionId: activeRules.id,
      createdAt: assessment.createdAt,
    };
  } catch (error) {
    console.error('Eligibility evaluation service error:', error);
    return {
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : 'Unknown error during eligibility evaluation',
      details: error,
    };
  }
}

/**
 * Get the latest eligibility assessment for a project
 * Returns assessment if found, null otherwise
 */
export async function getLatestEligibilityAssessment(projectId: string) {
  try {
    const assessment = await prisma.eligibilityAssessment.findFirst({
      where: {
        projectId,
        isLatest: true,
      },
      include: {
        grantRulesVersion: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!assessment) {
      return null;
    }

    return {
      assessmentId: assessment.id,
      projectId: assessment.projectId,
      overallDecision: assessment.overallDecision,
      programDecisions: assessment.programDecisions as Record<string, EligibilityDecision>,
      reasonCodes: assessment.reasonCodes as string[],
      missingRequirements: assessment.missingRequirements as string[],
      grantRulesVersionId: assessment.grantRulesVersionId,
      grantRulesVersionNumber: assessment.grantRulesVersion?.versionNumber,
      createdAt: assessment.createdAt,
      updatedAt: assessment.updatedAt,
    };
  } catch (error) {
    console.error('Failed to retrieve latest eligibility assessment:', error);
    return null;
  }
}

/**
 * Get assessment history for a project (all versions, latest first)
 */
export async function getEligibilityAssessmentHistory(projectId: string, limit: number = 10) {
  try {
    const assessments = await prisma.eligibilityAssessment.findMany({
      where: { projectId },
      include: {
        grantRulesVersion: {
          select: { versionNumber: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return assessments.map((a) => ({
      assessmentId: a.id,
      overallDecision: a.overallDecision,
      grantRulesVersionNumber: a.grantRulesVersion?.versionNumber,
      createdAt: a.createdAt,
      isLatest: a.isLatest,
    }));
  } catch (error) {
    console.error('Failed to retrieve eligibility assessment history:', error);
    return [];
  }
}

/**
 * Check if a project has been evaluated (helpful for UI)
 */
export async function hasEligibilityAssessment(projectId: string): Promise<boolean> {
  try {
    const count = await prisma.eligibilityAssessment.count({
      where: { projectId },
      take: 1,
    });
    return count > 0;
  } catch (error) {
    console.error('Failed to check eligibility assessment existence:', error);
    return false;
  }
}
