/**
 * FR-3.1 Eligibility Service
 * 
 * Orchestrates the eligibility evaluation workflow:
 * 1. Assemble EligibilityInput from Project + draftData
 * 2. Discover and rank grants from source-backed feeds
 * 3. Persist EligibilityAssessment snapshot
 * 4. Return result with assessment ID
 */

import { Prisma, Project, User } from '@prisma/client';
import { assembleEligibilityInput } from './assembler';
import { createEligibilityAssessmentSnapshot } from './repository';
import { EligibilityDecision } from './types';
import {
  discoverAndEvaluateGrants,
  DiscoveredGrant,
  GrantDiscoveryMetadata,
} from './discoverySearchProvider';
import { prisma } from 'lib/prisma';
import { logAuditEventNonBlocking } from '@/backend/audit/log';
import { produceManualReviewFlagJob } from './manualReviewProducer';

export interface EvaluateEligibilityServiceResult {
  assessmentId: string;
  projectId: string;
  overallDecision: EligibilityDecision;
  programDecisions: Record<string, EligibilityDecision>;
  reasonCodes: string[];
  staffReasonMessages: string[];
  clientReasonMessages: string[];
  missingRequirements: string[];
  discoveredGrants: DiscoveredGrant[];
  discoveryMetadata: GrantDiscoveryMetadata;
  createdAt: Date;
}

export interface EvaluateEligibilityServiceError {
  code: 'PERSISTENCE_FAILED' | 'UNKNOWN';
  message: string;
  details?: unknown;
}

/**
 * Main service function: evaluate and persist eligibility assessment
 */
export async function evaluateProjectEligibility(
  project: Project,
  performedBy?: User
): Promise<EvaluateEligibilityServiceResult | EvaluateEligibilityServiceError> {
  try {
    // Step 1: Assemble EligibilityInput from project
    const input = assembleEligibilityInput(project);

    // Step 2: Discover and rank grants from source-backed feeds
    const evaluation = await discoverAndEvaluateGrants(input);

    // Step 3: Persist assessment snapshot
    const assessment = await createEligibilityAssessmentSnapshot({
      projectId: project.id,
      overallDecision: evaluation.overallDecision,
      programDecisions: evaluation.programDecisions,
      reasonCodes: evaluation.reasonCodes,
      missingRequirements: evaluation.missingRequirements,
      discoveredGrants: evaluation.discoveredGrants as unknown as Prisma.InputJsonValue,
      discoveryMetadata: evaluation.discoveryMetadata as unknown as Prisma.InputJsonValue,
      discoveryProvider: evaluation.discoveryMetadata.provider,
      discoveryEngineVersion: evaluation.discoveryMetadata.engineVersion,
      discoveryPromptVersion: evaluation.discoveryMetadata.promptVersion,
      discoveryScoringVersion: evaluation.discoveryMetadata.scoringVersion,
      discoveryModelVersion: evaluation.discoveryMetadata.modelVersion,
      discoverySourceSnapshotId: evaluation.discoveryMetadata.sourceSnapshotId,
    });

    if (!assessment) {
      return {
        code: 'PERSISTENCE_FAILED',
        message: 'Failed to persist eligibility assessment',
      };
    }

    // Step 4: Audit log (if audit event creation is available)
    if (performedBy) {
      await logAuditEventNonBlocking({
        category: 'MANUAL_CHANGE',
        action: 'ELIGIBILITY_EVALUATED',
        outcome: 'SUCCESS',
        resourceType: 'EligibilityAssessment',
        resourceId: assessment.id,
        projectId: project.id,
        actorUserId: performedBy.id,
        description: `Eligibility discovery assessment: ${evaluation.overallDecision}`,
        metadata: {
          decision: evaluation.overallDecision,
          reasonCodes: evaluation.reasonCodes,
          discoveryProvider: evaluation.discoveryMetadata.provider,
          engineVersion: evaluation.discoveryMetadata.engineVersion,
          promptVersion: evaluation.discoveryMetadata.promptVersion,
          scoringVersion: evaluation.discoveryMetadata.scoringVersion,
          modelVersion: evaluation.discoveryMetadata.modelVersion,
          sourceSnapshotId: evaluation.discoveryMetadata.sourceSnapshotId,
          candidateCount: evaluation.discoveryMetadata.candidateCount,
          returnedCount: evaluation.discoveryMetadata.returnedCount,
        },
      });
    }

    // Step 5: Trigger manual review flag classification in background (non-blocking, FR-2.6)
    setImmediate(async () => {
      try {
        await produceManualReviewFlagJob(
          project.id,
          assessment.id,
          input,
          evaluation.discoveredGrants,
          evaluation.discoveryMetadata
        );
        console.log(`Manual review classification produced for project ${project.id}`);
      } catch (error) {
        console.warn(`Failed to produce manual review job for project ${project.id}:`, error);
        // Non-blocking: eligibility assessment success is not affected by manual review producer failure
      }
    });

    // Step 6: Trigger quote generation in background (non-blocking)
    setImmediate(async () => {
      try {
        // Dynamically import to avoid circular dependencies
        const { generateQuote } = await import('@/backend/services/quote');
        await generateQuote({
          projectId: project.id,
          items: [
            // TODO: Replace placeholder pricing with BuilderTrend-derived scope item pricing.
            {
              description: 'Home modifications (auto-quoted from eligibility assessment)',
              quantity: 1,
              unitPrice: 5000,
            },
          ],
        });
        console.log(`Auto-generated quote after eligibility assessment for project ${project.id}`);
      } catch (error) {
        console.warn(`Failed to auto-generate quote after eligibility assessment:`, error);
        // Non-blocking: eligibility assessment success is not affected by quote generation failure
      }
    });

    return {
      assessmentId: assessment.id,
      projectId: project.id,
      overallDecision: evaluation.overallDecision,
      programDecisions: evaluation.programDecisions,
      reasonCodes: evaluation.reasonCodes,
      staffReasonMessages: evaluation.staffReasonMessages,
      clientReasonMessages: evaluation.clientReasonMessages,
      missingRequirements: evaluation.missingRequirements,
      discoveredGrants: evaluation.discoveredGrants,
      discoveryMetadata: evaluation.discoveryMetadata,
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
      orderBy: { createdAt: 'desc' },
    });

    if (!assessment) {
      return null;
    }

    const assessmentWithDiscovery = assessment as typeof assessment & {
      discoveredGrants?: unknown;
      discoveryMetadata?: unknown;
      discoveryProvider?: unknown;
      discoveryEngineVersion?: unknown;
      discoveryPromptVersion?: unknown;
      discoveryScoringVersion?: unknown;
      discoveryModelVersion?: unknown;
      discoverySourceSnapshotId?: unknown;
    };

    return {
      assessmentId: assessment.id,
      projectId: assessment.projectId,
      overallDecision: assessment.overallDecision,
      programDecisions: assessment.programDecisions as Record<string, EligibilityDecision>,
      reasonCodes: assessment.reasonCodes as string[],
      missingRequirements: assessment.missingRequirements as string[],
      discoveredGrants: (assessmentWithDiscovery.discoveredGrants as DiscoveredGrant[] | null) ?? [],
      discoveryMetadata:
        (assessmentWithDiscovery.discoveryMetadata as GrantDiscoveryMetadata | null) ?? null,
      discoveryProvider:
        ((assessmentWithDiscovery.discoveryProvider as 'OPENAI' | 'HEURISTIC' | null) ?? 'HEURISTIC'),
      discoveryEngineVersion:
        (assessmentWithDiscovery.discoveryEngineVersion as string | null) ?? 'unknown',
      discoveryPromptVersion:
        (assessmentWithDiscovery.discoveryPromptVersion as string | null) ?? 'unknown',
      discoveryScoringVersion:
        (assessmentWithDiscovery.discoveryScoringVersion as string | null) ?? 'unknown',
      discoveryModelVersion:
        (assessmentWithDiscovery.discoveryModelVersion as string | null) ?? 'unknown',
      discoverySourceSnapshotId:
        (assessmentWithDiscovery.discoverySourceSnapshotId as string | null) ?? null,
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
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return assessments.map((a) => ({
      assessmentId: a.id,
      overallDecision: a.overallDecision,
      discoveryProvider:
        ((a as typeof a & { discoveryProvider?: string | null }).discoveryProvider ?? 'HEURISTIC'),
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
