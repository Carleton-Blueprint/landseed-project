/**
 * FR-3.1 Automatic Re-evaluation on Grant Rules Version Activation
 * 
 * When new grant rules version is activated:
 * 1. Find all projects with active assessments
 * 2. Re-evaluate them against new rules (if significant change detected)
 * 3. Create new assessment snapshots if decision changes
 * 4. Log re-evaluation events
 * 
 * Safeguards:
 * - Only re-evaluate if rules actually changed (impact analysis)
 * - Batch processing with delays to avoid DB overload
 * - Non-blocking: failures don't propagate
 * - Staff can review re-evaluated projects in admin dashboard
 */

import { GrantRulesVersion } from '@prisma/client';
import { evaluateProjectEligibility } from './service';
import prisma from 'lib/prisma';

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 100; // Milliseconds between batches

/**
 * Check if rule changes could affect eligibility decisions
 * Simple heuristic: if eligibility sections changed, likely impact
 */
function rulesHaveImpactfulChanges(oldRules: any, newRules: any): boolean {
  if (!oldRules || !newRules) return true;

  // Check if eligibility or province rules differ
  const oldEligibility = JSON.stringify(oldRules.eligibility || {});
  const newEligibility = JSON.stringify(newRules.eligibility || {});

  const oldProvinces = JSON.stringify(oldRules.provinces || {});
  const newProvinces = JSON.stringify(newRules.provinces || {});

  return oldEligibility !== newEligibility || oldProvinces !== newProvinces;
}

/**
 * Trigger re-evaluation of all projects when new rules are activated
 * Non-blocking: starts background process
 */
export async function triggerReEvaluationOnRuleActivation(
  newRulesVersion: GrantRulesVersion,
  oldRulesVersion?: GrantRulesVersion
): Promise<void> {
  // Don't block the activation endpoint
  setImmediate(async () => {
    try {
      // Check if rules actually changed significantly
      if (
        oldRulesVersion &&
        !rulesHaveImpactfulChanges(oldRulesVersion.rules, newRulesVersion.rules)
      ) {
        console.log(
          `Grant rules v${newRulesVersion.versionNumber} activated with no impactful changes`
        );
        return;
      }

      console.log(
        `Triggering re-evaluation of all projects due to rules v${newRulesVersion.versionNumber} activation`
      );

      // Get all projects that have eligibility assessments
      const projectsWithAssessments = await prisma.eligibilityAssessment.findMany({
        where: { isLatest: true },
        select: { projectId: true },
        distinct: ['projectId'],
      });

      const projectIds = projectsWithAssessments.map((a) => a.projectId);
      console.log(`Found ${projectIds.length} projects with assessments to re-evaluate`);

      // Process in batches
      for (let i = 0; i < projectIds.length; i += BATCH_SIZE) {
        const batch = projectIds.slice(i, i + BATCH_SIZE);

        // Schedule batch processing with delay
        setTimeout(async () => {
          for (const projectId of batch) {
            try {
              const project = await prisma.project.findUnique({
                where: { id: projectId },
              });

              if (project) {
                const result = await evaluateProjectEligibility(project);

                if (!('code' in result)) {
                  // Successful evaluation
                  console.log(
                    `Re-evaluated project ${projectId}: ${result.overallDecision}`
                  );

                  // Log re-evaluation event
                  try {
                    await prisma.auditEvent.create({
                      data: {
                        category: 'MANUAL_CHANGE',
                        action: 'ELIGIBILITY_REEVALUATED_ON_RULE_CHANGE',
                        outcome: 'SUCCESS',
                        resourceType: 'EligibilityAssessment',
                        projectId: projectId,
                        description: `Re-evaluated due to rules v${newRulesVersion.versionNumber} activation`,
                        metadata: {
                          decisionAfterReEvaluation: result.overallDecision,
                          newRulesVersion: newRulesVersion.versionNumber,
                        },
                      },
                    });
                  } catch (_auditError) {
                    // Audit failure should not block
                  }
                }
              }
            } catch (projectError) {
              console.warn(`Failed to re-evaluate project ${projectId}:`, projectError);
            }
          }

          const batchNum = Math.floor(i / BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(projectIds.length / BATCH_SIZE);
          console.log(`Completed re-evaluation batch ${batchNum}/${totalBatches}`);
        }, (Math.floor(i / BATCH_SIZE) * BATCH_DELAY_MS));
      }

      console.log(`Scheduled re-evaluation of ${projectIds.length} projects in batches`);
    } catch (error) {
      console.error(
        'Failed to trigger re-evaluation on rule activation:',
        error
      );
    }
  });
}

/**
 * Get list of projects whose assessments changed after rule update
 * Useful for compliance/audit reporting
 */
export async function getProjectsImpactedByRuleChange(
  oldRulesVersionId: string,
  newRulesVersionId: string
) {
  try {
    // Find assessments made with old rules
    const oldAssessments = await prisma.eligibilityAssessment.findMany({
      where: { grantRulesVersionId: oldRulesVersionId },
      select: { projectId: true, overallDecision: true },
    });

    // Find assessments made with new rules
    const newAssessments = await prisma.eligibilityAssessment.findMany({
      where: { grantRulesVersionId: newRulesVersionId },
      select: { projectId: true, overallDecision: true },
    });

    // Find projects where decision changed
    const oldAssessmentMap = new Map(
      oldAssessments.map((a) => [a.projectId, a.overallDecision])
    );
    const newAssessmentMap = new Map(
      newAssessments.map((a) => [a.projectId, a.overallDecision])
    );

    const impactedProjects = [];
    for (const [projectId, oldDecision] of oldAssessmentMap) {
      const newDecision = newAssessmentMap.get(projectId);
      if (newDecision && newDecision !== oldDecision) {
        impactedProjects.push({
          projectId,
          oldDecision,
          newDecision,
        });
      }
    }

    return impactedProjects;
  } catch (error) {
    console.error('Failed to get projects impacted by rule change:', error);
    return [];
  }
}
