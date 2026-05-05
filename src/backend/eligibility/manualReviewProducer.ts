import { EligibilityInput } from '@/backend/eligibility/types';
import { classifyManualReviewNeed } from '@/backend/eligibility/manualReviewClassifier';
import { manualReviewQueue } from '@/backend/queue';
import {
  DiscoveredGrant,
  GrantDiscoveryMetadata,
} from '@/backend/eligibility/discoverySearchProvider';
import { FeatureFlag, isFeatureFlagEnabled } from '@/backend/features/flags';

export async function produceManualReviewFlagJob(
  projectId: string,
  assessmentId: string,
  input: EligibilityInput,
  discoveredGrants: DiscoveredGrant[],
  discoveryMetadata: GrantDiscoveryMetadata
): Promise<boolean> {
  // Feature flag controls auto-flag enablement for safe rollout
  if (!isFeatureFlagEnabled(FeatureFlag.MANUAL_REVIEW_AUTO_FLAG)) {
    console.log(
      `[ManualReviewProducer] MANUAL_REVIEW_AUTO_FLAG is disabled, skipping for project ${projectId}`
    );
    return false;
  }

  const aiConfidence = deriveOverallAiConfidence(discoveredGrants);
  const discoveredGrantsCount = discoveredGrants.length;
  const totalCandidatesCount = discoveryMetadata.candidateCount || 0;

  const classification = classifyManualReviewNeed(
    input,
    aiConfidence,
    discoveredGrantsCount,
    totalCandidatesCount
  );

  if (!classification.shouldFlag) {
    console.log(
      `[ManualReviewProducer] No flag needed for project ${projectId} ` +
        `(confidence: ${aiConfidence}, complexity score: ${classification.complexityScore ?? 0})`
    );
    return false;
  }

  await manualReviewQueue.add(
    'manual-review-flag',
    {
      projectId,
      assessmentId,
      aiConfidence,
      complexityScore: classification.complexityScore,
      reason: classification.reason,
    },
    {
      jobId: `manual-review-${projectId}-${assessmentId}`,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    }
  );

  console.log(
    `[ManualReviewProducer] Enqueued job for project ${projectId} ` +
      `(reason: ${classification.reason}, complexity: ${classification.complexityScore ?? 0})`
  );

  return true;
}

/**
 * Derive overall AI confidence from individual grant confidences.
 * Uses the most common level. Ties break: HIGH > MEDIUM > LOW.
 * Falls back to MEDIUM if no grants discovered.
 */
function deriveOverallAiConfidence(
  discoveredGrants: DiscoveredGrant[]
): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (discoveredGrants.length === 0) {
    return 'MEDIUM';
  }

  const counts: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };

  for (const grant of discoveredGrants) {
    counts[grant.confidence as 'HIGH' | 'MEDIUM' | 'LOW']++;
  }

  if (counts.HIGH >= counts.MEDIUM && counts.HIGH >= counts.LOW) return 'HIGH';
  if (counts.MEDIUM >= counts.LOW) return 'MEDIUM';
  return 'LOW';
}