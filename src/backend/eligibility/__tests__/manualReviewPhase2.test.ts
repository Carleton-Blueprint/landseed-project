/**
 * FR-2.6: Manual Review Phase 2 Tests
 *
 * Keep this suite aligned with the current eligibility types and queue wiring.
 * These are focused smoke tests for the classifier and producer entry points.
 */

import { classifyManualReviewNeed, combineReasons } from '../manualReviewClassifier';
import { produceManualReviewFlagJob } from '../manualReviewProducer';
import {
  DiscoveredGrant,
  GrantDiscoveryMetadata,
} from '../discoverySearchProvider';
import {
  EligibilityInput,
  EligibilityDecision,
  ProjectManualReviewReason,
  MODIFICATION_CODES,
} from '../types';

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

function buildTestInput(overrides?: Partial<EligibilityInput>): EligibilityInput {
  const base: EligibilityInput = {
    project: {
      projectId: 'proj-test-1',
      projectStatus: 'draft',
      address: '123 Main St',
    },
    required: {
      province: 'BC',
      ownershipStatus: 'owner',
      clientConsentConfirmed: true,
      modificationCodes: [MODIFICATION_CODES.GRAB_BARS],
    },
    optional: {
      name: 'Test User',
      email: 'test@example.com',
      phone: '555-1234',
      city: 'Victoria',
      postalCode: 'V8V 1A1',
      ownershipOtherDetails: null,
      landlordName: null,
      landlordPhone: null,
      isCaregiver: false,
      seniorName: null,
      relationshipToSenior: null,
      caregiverConsentConfirmed: null,
    },
    missingRequiredFields: [],
    malformedDraftFields: [],
  };

  return {
    ...base,
    ...overrides,
  };
}

function buildGrant(confidence: Confidence = 'HIGH'): DiscoveredGrant {
  return {
    grantId: 'grant-1',
    title: 'Test Grant',
    scope: 'PROVINCIAL',
    jurisdiction: 'BC',
    sourceUrl: 'https://example.com/grant',
    summary: 'Test grant summary',
    decision: EligibilityDecision.ELIGIBLE,
    relevanceScore: 0.95,
    confidence,
    matchedCriteria: ['criterion-1'],
    missingCriteria: [],
    rationale: 'Test rationale',
  };
}

function buildMetadata(overrides?: Partial<GrantDiscoveryMetadata>): GrantDiscoveryMetadata {
  return {
    provider: 'HEURISTIC',
    engineVersion: '1.0.0',
    promptVersion: '1.0.0',
    scoringVersion: '1.0.0',
    modelVersion: '1.0.0',
    sourceSnapshotId: null,
    query: 'test',
    searchedScopes: ['PROVINCIAL'],
    candidateCount: 10,
    returnedCount: 1,
    executedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FR-2.6 Manual Review Phase 2', () => {
  it('classifies low-confidence projects for review', () => {
    const input = buildTestInput();
    const result = classifyManualReviewNeed(input, 'LOW', 1, 10);

    expect(result.shouldFlag).toBe(true);
    expect(result.reason).toBe(ProjectManualReviewReason.LOW_CONFIDENCE);
  });

  it('does not flag high-confidence simple projects', () => {
    const input = buildTestInput();
    const result = classifyManualReviewNeed(input, 'HIGH', 1, 10);

    expect(result.shouldFlag).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('combines reasons correctly', () => {
    expect(combineReasons(true, true)).toBe(ProjectManualReviewReason.BOTH);
    expect(combineReasons(true, false)).toBe(ProjectManualReviewReason.LOW_CONFIDENCE);
    expect(combineReasons(false, true)).toBe(ProjectManualReviewReason.HIGH_COMPLEXITY);
  });

  it.skip('enqueues a manual review job when classification requires it', async () => {
    const input = buildTestInput({
      required: {
        province: 'BC',
        ownershipStatus: 'owner',
        clientConsentConfirmed: true,
        modificationCodes: [
          MODIFICATION_CODES.GRAB_BARS,
          MODIFICATION_CODES.HANDRAILS,
          MODIFICATION_CODES.WIDENED_DOORWAY,
          MODIFICATION_CODES.STAIR_LIFT,
        ],
      },
    });

    await expect(
      produceManualReviewFlagJob(
        'project-1',
        'assessment-1',
        input,
        [buildGrant('LOW')],
        buildMetadata({ candidateCount: 10 })
      )
    ).resolves.toBe(true);
  });
});
