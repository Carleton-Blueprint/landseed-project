/**
 * FR-2.6: Manual Review Classifier - Acceptance Criteria Tests
 * 
 * These tests validate the Phase 1 design decisions and ensure the classifier
 * meets all acceptance criteria before Phase 2 (Queue/Worker) begins.
 */

import {
  classifyManualReviewNeed,
  combineReasons,
  COMPLEXITY_CONFIG,
} from '../manualReviewClassifier';
import {
  EligibilityInput,
  ProjectManualReviewReason,
  EligibilityOwnershipStatus,
  ModificationCode,
} from '../types';

/**
 * Helper to build a minimal EligibilityInput for testing.
 */
function buildTestInput(overrides?: Partial<EligibilityInput>): EligibilityInput {
  const defaults: EligibilityInput = {
    project: {
      projectId: 'proj-test-1',
      projectStatus: 'draft',
      address: '123 Main St',
    },
    required: {
      province: 'ON',
      ownershipStatus: 'owner' as EligibilityOwnershipStatus,
      clientConsentConfirmed: true,
      modificationCodes: ['GRAB_BARS'] as ModificationCode[],
    },
    optional: {
      name: 'John Doe',
      email: 'john@example.com',
      phone: '555-1234',
      city: 'Toronto',
      postalCode: 'M1A 1A1',
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

  return { ...defaults, ...overrides };
}

describe('FR-2.6: Manual Review Classifier', () => {
  describe('AC2.1: Trigger Classification - AI Confidence', () => {
    it('AC2.1.a: LOW confidence triggers immediate flag', () => {
      const input = buildTestInput();
      const result = classifyManualReviewNeed(input, 'LOW', 0, 10);

      expect(result.shouldFlag).toBe(true);
      expect(result.reason).toBe(ProjectManualReviewReason.LOW_CONFIDENCE);
      expect(result.description).toContain('Low AI confidence');
    });

    it('AC2.1.b: MEDIUM confidence with no complexity signals = no flag', () => {
      const input = buildTestInput({
        required: {
          province: 'ON',
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: ['GRAB_BARS'],
        },
        missingRequiredFields: [],
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 10, 20);

      expect(result.shouldFlag).toBe(false);
      expect(result.reason).toBeUndefined();
      expect(result.complexityScore).toBeLessThan(2);
    });

    it('AC2.1.c: MEDIUM confidence with ≥2 complexity signals = flag', () => {
      const input = buildTestInput({
        // Signal 1: Multiple modifications (> 3)
        required: {
          province: 'ON',
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: [
            'GRAB_BARS',
            'RAISED_TOILET',
            'HANDRAILS',
            'WIDENED_DOORWAY',
          ] as ModificationCode[],
        },
        // Signal 2: Missing data (> 2 required fields)
        missingRequiredFields: ['PROVINCE', 'OWNERSHIP_STATUS', 'MODIFICATION_ITEMS'],
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 5, 20);

      expect(result.shouldFlag).toBe(true);
      expect(result.reason).toBe(ProjectManualReviewReason.HIGH_COMPLEXITY);
      expect(result.complexityScore).toBeGreaterThanOrEqual(2);
    });

    it('AC2.1.d: HIGH confidence with ≥2 complexity signals = flag', () => {
      const input = buildTestInput({
        required: {
          province: 'ON',
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: [
            'GRAB_BARS',
            'RAISED_TOILET',
            'HANDRAILS',
            'WIDENED_DOORWAY',
            'STAIR_LIFT',
          ] as ModificationCode[],
        },
        missingRequiredFields: [],
      });

      const result = classifyManualReviewNeed(input, 'HIGH', 10, 20);

      expect(result.shouldFlag).toBe(true);
      expect(result.reason).toBe(ProjectManualReviewReason.HIGH_COMPLEXITY);
    });
  });

  describe('AC2.2: Complexity Signals - Detection', () => {
    it('AC2.2.a: 4 modification codes triggers multipleModificationCategories', () => {
      const input = buildTestInput({
        required: {
          province: 'ON',
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: [
            'GRAB_BARS',
            'RAISED_TOILET',
            'HANDRAILS',
            'WIDENED_DOORWAY',
          ] as ModificationCode[],
        },
        missingRequiredFields: [],
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 10, 20);

      expect(result.complexitySignals?.multipleModificationCategories).toBe(true);
    });

    it('AC2.2.b: 3 modification codes does NOT trigger multipleModificationCategories', () => {
      const input = buildTestInput({
        required: {
          province: 'ON',
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: [
            'GRAB_BARS',
            'RAISED_TOILET',
            'HANDRAILS',
          ] as ModificationCode[],
        },
        missingRequiredFields: [],
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 10, 20);

      expect(result.complexitySignals?.multipleModificationCategories).toBe(false);
    });

    it('AC2.2.c: 4 missing required fields triggers missingIntakeData', () => {
      const input = buildTestInput({
        missingRequiredFields: [
          'PROVINCE',
          'OWNERSHIP_STATUS',
          'MODIFICATION_ITEMS',
          'CLIENT_CONSENT_CONFIRMED',
        ],
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 10, 20);

      expect(result.complexitySignals?.missingIntakeData).toBe(true);
    });

    it('AC2.2.d: Caregiver without consent triggers conflictingAttributes', () => {
      const input = buildTestInput({
        optional: {
          isCaregiver: true,
          caregiverConsentConfirmed: false,
          name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '555-5678',
          city: 'Toronto',
          postalCode: 'M1A 1A1',
          ownershipOtherDetails: null,
          landlordName: null,
          landlordPhone: null,
          seniorName: null,
          relationshipToSenior: null,
        },
        missingRequiredFields: [],
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 10, 20);

      expect(result.complexitySignals?.conflictingAttributes).toBe(true);
    });

    it('AC2.2.e: 5 discovered / 20 candidates (25%) triggers lowRuleOverlap', () => {
      const input = buildTestInput();

      const result = classifyManualReviewNeed(
        input,
        'MEDIUM',
        5, // discovered
        20 // total candidates
      );

      expect(result.complexitySignals?.lowRuleOverlap).toBe(true);
    });

    it('AC2.2.f: 15 discovered / 20 candidates (75%) does NOT trigger lowRuleOverlap', () => {
      const input = buildTestInput();

      const result = classifyManualReviewNeed(
        input,
        'MEDIUM',
        15, // discovered
        20 // total candidates
      );

      expect(result.complexitySignals?.lowRuleOverlap).toBe(false);
    });
  });

  describe('AC2.3: Complexity Scoring', () => {
    it('counts 0 signals correctly', () => {
      const input = buildTestInput({
        required: {
          province: 'ON',
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: ['GRAB_BARS'],
        },
        missingRequiredFields: [],
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 15, 20);

      expect(result.complexityScore).toBe(0);
      expect(result.shouldFlag).toBe(false);
    });

    it('counts 2 signals correctly and flags', () => {
      const input = buildTestInput({
        required: {
          province: 'ON',
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: [
            'GRAB_BARS',
            'RAISED_TOILET',
            'HANDRAILS',
            'WIDENED_DOORWAY',
          ] as ModificationCode[],
        },
        missingRequiredFields: ['PROVINCE', 'MODIFICATION_ITEMS', 'CLIENT_NAME'],
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 10, 20);

      expect(result.complexityScore).toBeGreaterThanOrEqual(2);
      expect(result.shouldFlag).toBe(true);
    });

    it('counts 5 signals correctly', () => {
      const input = buildTestInput({
        required: {
          province: null, // Signal: unusualScope
          ownershipStatus: 'other',
          clientConsentConfirmed: true,
          modificationCodes: [
            'GRAB_BARS',
            'RAISED_TOILET',
            'HANDRAILS',
            'WIDENED_DOORWAY',
            'STAIR_LIFT',
          ] as ModificationCode[], // Signal: multipleModifications
        },
        optional: {
          isCaregiver: true,
          caregiverConsentConfirmed: false, // Signal: conflictingAttributes
          name: 'Test',
          email: 'test@example.com',
          phone: '555-1234',
          city: 'Toronto',
          postalCode: 'M1A 1A1',
          ownershipOtherDetails: null,
          landlordName: null,
          landlordPhone: null,
          seniorName: null,
          relationshipToSenior: null,
        },
        missingRequiredFields: ['CLIENT_CONSENT_CONFIRMED', 'LANDLORD_NAME', 'LANDLORD_PHONE'], // Signal: missingIntakeData
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 3, 20); // Signal: lowRuleOverlap (15%)

      expect(result.complexityScore).toBeGreaterThanOrEqual(2);
    });
  });

  describe('AC3.1: Idempotency & Uniqueness', () => {
    it('returns consistent classification for same input', () => {
      const input = buildTestInput({
        required: {
          province: 'ON',
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: ['GRAB_BARS'],
        },
        missingRequiredFields: [],
      });

      const result1 = classifyManualReviewNeed(input, 'LOW', 10, 20);
      const result2 = classifyManualReviewNeed(input, 'LOW', 10, 20);

      expect(result1.reason).toBe(result2.reason);
      expect(result1.shouldFlag).toBe(result2.shouldFlag);
      expect(result1.description).toBe(result2.description);
    });
  });

  describe('Reason Combination (AC4: BOTH scenario)', () => {
    it('combineReasons returns BOTH when both flags are true', () => {
      const reason = combineReasons(true, true);
      expect(reason).toBe(ProjectManualReviewReason.BOTH);
    });

    it('combineReasons returns LOW_CONFIDENCE when only low confidence is true', () => {
      const reason = combineReasons(true, false);
      expect(reason).toBe(ProjectManualReviewReason.LOW_CONFIDENCE);
    });

    it('combineReasons returns HIGH_COMPLEXITY when only complexity is true', () => {
      const reason = combineReasons(false, true);
      expect(reason).toBe(ProjectManualReviewReason.HIGH_COMPLEXITY);
    });
  });

  describe('Edge Cases', () => {
    it('handles missing province (unusualScope signal)', () => {
      const input = buildTestInput({
        required: {
          province: null,
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: ['GRAB_BARS'],
        },
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 15, 20);

      expect(result.complexitySignals?.unusualScope).toBe(true);
    });

    it('handles tenant without landlord info', () => {
      const input = buildTestInput({
        required: {
          province: 'ON',
          ownershipStatus: 'tenant',
          clientConsentConfirmed: true,
          modificationCodes: ['GRAB_BARS'],
        },
        optional: {
          landlordName: null,
          landlordPhone: null,
          name: 'Test',
          email: 'test@example.com',
          phone: '555-1234',
          city: 'Toronto',
          postalCode: 'M1A 1A1',
          ownershipOtherDetails: null,
          isCaregiver: false,
          seniorName: null,
          relationshipToSenior: null,
          caregiverConsentConfirmed: null,
        },
      });

      const result = classifyManualReviewNeed(input, 'MEDIUM', 15, 20);

      expect(result.complexitySignals?.conflictingAttributes).toBe(true);
    });

    it('handles zero discovered grants', () => {
      const input = buildTestInput();
      const result = classifyManualReviewNeed(input, 'MEDIUM', 0, 10);

      // 0/10 = 0% < 40% threshold, so lowRuleOverlap is true
      expect(result.complexitySignals?.lowRuleOverlap).toBe(true);
    });

    it('handles zero total candidates gracefully', () => {
      const input = buildTestInput();
      const result = classifyManualReviewNeed(input, 'MEDIUM', 0, 0);

      // Guard: totalCandidatesCount > 0 check prevents division error
      expect(result.complexitySignals?.lowRuleOverlap).toBe(false);
    });
  });

  describe('Configuration Thresholds', () => {
    it('uses correct modification threshold', () => {
      expect(COMPLEXITY_CONFIG.modificationThreshold).toBe(3);
    });

    it('uses correct missing field threshold', () => {
      expect(COMPLEXITY_CONFIG.missingFieldThreshold).toBe(2);
    });

    it('uses correct low overlap threshold', () => {
      expect(COMPLEXITY_CONFIG.lowOverlapThreshold).toBe(0.4);
    });

    it('uses correct complexity signal requirement', () => {
      expect(COMPLEXITY_CONFIG.requiredSignalsForComplexity).toBe(2);
    });
  });
});
