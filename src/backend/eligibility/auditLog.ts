/**
 * FR-3.1 Audit Events for Eligibility Lifecycle
 * 
 * Logs all significant eligibility evaluation events:
 * - Assessment created/updated
 * - Decision changed
 * - Eligibility reviewed by staff
 * - Re-evaluation triggered
 * 
 * All events are created with appropriate sensitivity levels:
 * - INTERNAL: Staff can see, standard operations
 * - CONFIDENTIAL: Eligibility decisions, personal info
 */

import {
  Project,
  User,
  AuditEventCategory,
  AuditEventOutcome,
  AuditSensitivityLevel,
} from '@prisma/client';
import { EligibilityDecision } from './types';
import { EvaluateEligibilityServiceResult } from './service';
import { prisma } from 'lib/prisma';
import { logAuditEventNonBlocking } from '@/backend/audit/log';

/**
 * Log assessment created event
 */
export async function logEligibilityAssessmentCreated(
  project: Project,
  assessment: EvaluateEligibilityServiceResult,
  performedBy: User
): Promise<void> {
  await logAuditEventNonBlocking({
    category: AuditEventCategory.MANUAL_CHANGE,
    action: 'ELIGIBILITY_ASSESSMENT_CREATED',
    outcome: AuditEventOutcome.SUCCESS,
    sensitivityLevel: AuditSensitivityLevel.CONFIDENTIAL,
    projectId: project.id,
    actorUserId: performedBy.id,
    resourceType: 'EligibilityAssessment',
    resourceId: assessment.assessmentId,
    description: `Eligibility assessment created: ${assessment.overallDecision}`,
    metadata: {
      overallDecision: assessment.overallDecision,
      programDecisions: assessment.programDecisions,
      reasonCodes: assessment.reasonCodes,
      missingRequirements: assessment.missingRequirements,
    },
  });
}

/**
 * Log assessment decision changed event
 */
export async function logEligibilityDecisionChanged(
  projectId: string,
  assessmentId: string,
  oldDecision: EligibilityDecision,
  newDecision: EligibilityDecision,
  performedBy?: User
): Promise<void> {
  await logAuditEventNonBlocking({
    category: AuditEventCategory.MANUAL_CHANGE,
    action: 'ELIGIBILITY_DECISION_CHANGED',
    outcome: AuditEventOutcome.SUCCESS,
    sensitivityLevel: AuditSensitivityLevel.CONFIDENTIAL,
    projectId: projectId,
    actorUserId: performedBy?.id,
    resourceType: 'EligibilityAssessment',
    resourceId: assessmentId,
    description: `Eligibility decision changed: ${oldDecision} → ${newDecision}`,
    beforeState: { decision: oldDecision },
    afterState: { decision: newDecision },
    metadata: {
      oldDecision,
      newDecision,
    },
  });
}

/**
 * Log eligibility assessment accessed during manual review
 */
export async function logEligibilityAssessmentReviewed(
  projectId: string,
  assessmentId: string,
  reviewedBy: User,
  notes?: string
): Promise<void> {
  await logAuditEventNonBlocking({
    category: AuditEventCategory.SENSITIVE_ACCESS,
    action: 'ELIGIBILITY_ASSESSMENT_REVIEWED',
    outcome: AuditEventOutcome.SUCCESS,
    sensitivityLevel: AuditSensitivityLevel.CONFIDENTIAL,
    projectId: projectId,
    actorUserId: reviewedBy.id,
    resourceType: 'EligibilityAssessment',
    resourceId: assessmentId,
    description: `Staff reviewed eligibility assessment${notes ? ': ' + notes : ''}`,
    metadata: {
      reviewedBy: reviewedBy.email,
      reviewNotes: notes,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log re-evaluation event
 */
export async function logEligibilityReEvaluation(
  projectId: string,
  oldAssessmentId: string,
  newAssessmentId: string,
  oldDecision: EligibilityDecision,
  newDecision: EligibilityDecision,
  reason: string
): Promise<void> {
  await logAuditEventNonBlocking({
    category: AuditEventCategory.MANUAL_CHANGE,
    action: 'ELIGIBILITY_REEVALUATED',
    outcome: AuditEventOutcome.SUCCESS,
    sensitivityLevel: AuditSensitivityLevel.CONFIDENTIAL,
    projectId: projectId,
    resourceType: 'EligibilityAssessment',
    resourceId: newAssessmentId,
    description: `Eligibility re-evaluated: ${oldDecision} → ${newDecision}. Reason: ${reason}`,
    beforeState: { assessmentId: oldAssessmentId, decision: oldDecision },
    afterState: { assessmentId: newAssessmentId, decision: newDecision },
    metadata: {
      oldAssessmentId,
      newAssessmentId,
      oldDecision,
      newDecision,
      reason,
    },
  });
}

/**
 * Log assessment needs more information
 */
export async function logEligibilityNeedsMoreInfo(
  projectId: string,
  assessmentId: string,
  missingFields: string[]
): Promise<void> {
  await logAuditEventNonBlocking({
    category: AuditEventCategory.MANUAL_CHANGE,
    action: 'ELIGIBILITY_NEEDS_MORE_INFO',
    outcome: AuditEventOutcome.SUCCESS,
    sensitivityLevel: AuditSensitivityLevel.INTERNAL,
    projectId: projectId,
    resourceType: 'EligibilityAssessment',
    resourceId: assessmentId,
    description: `Eligibility assessment requires more information: ${missingFields.join(', ')}`,
    metadata: {
      missingFields,
    },
  });
}

/**
 * Log assessment failure/error
 */
export async function logEligibilityAssessmentError(
  projectId: string,
  errorMessage: string,
  performedBy?: User
): Promise<void> {
  await logAuditEventNonBlocking({
    category: AuditEventCategory.SENSITIVE_ACCESS,
    action: 'ELIGIBILITY_ASSESSMENT_FAILED',
    outcome: AuditEventOutcome.FAILURE,
    sensitivityLevel: AuditSensitivityLevel.INTERNAL,
    projectId: projectId,
    actorUserId: performedBy?.id,
    resourceType: 'EligibilityAssessment',
    description: `Eligibility assessment failed: ${errorMessage}`,
    metadata: {
      error: errorMessage,
    },
  });
}

/**
 * Get audit history for a project's eligibility assessments
 */
export async function getEligibilityAuditHistory(projectId: string, limit: number = 20) {
  try {
    const events = await prisma.auditEvent.findMany({
      where: {
        projectId,
        action: {
          in: [
            'ELIGIBILITY_ASSESSMENT_CREATED',
            'ELIGIBILITY_DECISION_CHANGED',
            'ELIGIBILITY_REEVALUATED',
            'ELIGIBILITY_ASSESSMENT_REVIEWED',
            'ELIGIBILITY_NEEDS_MORE_INFO',
          ],
        },
      },
      include: {
        actorUser: {
          select: {
            email: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return events.map((event) => ({
      id: event.id,
      action: event.action,
      outcome: event.outcome,
      description: event.description,
      createdAt: event.createdAt,
      actorEmail: event.actorUser?.email,
      actorName: event.actorUser?.name,
      metadata: event.metadata,
    }));
  } catch (error) {
    console.error('Failed to retrieve eligibility audit history:', error);
    return [];
  }
}
