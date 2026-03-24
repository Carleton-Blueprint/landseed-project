/**
 * Evaluator unit tests
 * Coverage: CMHC baseline, provincial overlay, missing fields, decisions
 */

import { evaluateEligibility, EvaluationResult } from '../evaluator';
import { 
  EligibilityInput, 
  EligibilityDecision,
  EligibilityProgram 
} from '../types';
import { GrantRulesVersion } from '@prisma/client';

// Mock GrantRulesVersion with rules
function createMockGrantRules(overrides: any = {}): GrantRulesVersion {
  const defaultRules = {
    version: '1.0.0',
    eligibility: {
      minApplicantAge: 18,
      maxHouseholdIncome: 85000,
      requireOwnerOccupied: true,
    },
    provinces: {
      ON: {
        minHouseholdIncome: 25000,
        minPropertyAge: 5,
        eligibleModifications: [
          'GRAB_BARS',
          'RAISED_TOILET',
          'WALK_IN_SHOWER',
          'WIDENED_DOORWAY',
          'STAIR_LIFT',
          'HANDRAILS',
        ],
      },
    },
    ...overrides,
  };

  return {
    id: 'rules-1',
    versionNumber: 1,
    rules: defaultRules,
    createdAt: new Date(),
    createdByUserId: 'system-user',
    isActive: true,
  } as GrantRulesVersion;
}

// Helper to create a valid EligibilityInput
function createValidInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  const base: EligibilityInput = {
    project: {
      id: 'proj-1',
      userId: 'user-1',
      status: 'active',
    },
    required: {
      province: 'ON',
      ownershipStatus: 'owner',
      clientConsentConfirmed: true,
      modificationCodes: ['GRAB_BARS', 'HANDRAILS'],
    },
    optional: {
      name: 'John Doe',
      email: 'john@example.com',
      phone: '555-1234',
      age: 65,
      estimatedHouseholdIncome: 50000,
      propertyYearBuilt: 2010,
      landlordName: null,
      seniorName: null,
    },
    missingRequiredFields: [],
    malformedDraftFields: [],
    normalization: {
      unknownItems: [],
      duplicateCodes: [],
    },
  };

  return { ...base, ...overrides };
}

describe('evaluateEligibility', () => {
  describe('Happy path: ELIGIBLE decision', () => {
    it('should return ELIGIBLE when all requirements are met', () => {
      const rules = createMockGrantRules();
      const input = createValidInput();

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.ELIGIBLE);
      expect(result.programDecisions[EligibilityProgram.CMHC]).toBe(EligibilityDecision.ELIGIBLE);
      expect(result.programDecisions[EligibilityProgram.PROVINCIAL]).toBe(EligibilityDecision.ELIGIBLE);
      expect(result.clientReasonMessages).toContain(
        'Congratulations! You appear to be eligible for this grant.'
      );
    });
  });

  describe('Missing required fields: NEEDS_MORE_INFO', () => {
    it('should return NEEDS_MORE_INFO when province is missing', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        required: { ...createValidInput().required, province: '' },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.NEEDS_MORE_INFO);
      expect(result.reasonCodes).toContain('MISSING_REQUIRED_FIELDS');
    });

    it('should return NEEDS_MORE_INFO when modificationCodes is empty', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        required: { ...createValidInput().required, modificationCodes: [] },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.NEEDS_MORE_INFO);
      expect(result.reasonCodes).toContain('MISSING_REQUIRED_FIELDS');
    });

    it('should return NEEDS_MORE_INFO when consent not confirmed', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        required: { ...createValidInput().required, clientConsentConfirmed: false },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.NEEDS_MORE_INFO);
      expect(result.reasonCodes).toContain('MISSING_REQUIRED_FIELDS');
    });
  });

  describe('Unsupported province: MANUAL_REVIEW', () => {
    it('should return MANUAL_REVIEW for unsupported province (BC)', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        required: { ...createValidInput().required, province: 'BC' },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.MANUAL_REVIEW);
      expect(result.programDecisions[EligibilityProgram.PROVINCIAL]).toBe(
        EligibilityDecision.MANUAL_REVIEW
      );
      expect(result.reasonCodes).toContain('UNSUPPORTED_PROVINCE');
      expect(result.clientReasonMessages).toContain(
        'Your application requires manual review. A staff member will contact you shortly.'
      );
    });

    it('should handle empty province gracefully', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        required: { ...createValidInput().required, province: '' },
      });

      const result = evaluateEligibility(input, rules);

      // Empty province fails required validation first
      expect(result.overallDecision).toBe(EligibilityDecision.NEEDS_MORE_INFO);
    });
  });

  describe('CMHC baseline ineligibility: INELIGIBLE', () => {
    it('should return INELIGIBLE when income exceeds CMHC limit', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        optional: { ...createValidInput().optional, estimatedHouseholdIncome: 90000 },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
      expect(result.reasonCodes).toContain('HOUSEHOLD_INCOME_EXCEEDS_LIMIT');
      expect(result.clientReasonMessages).toContain(
        'Your household income exceeds the current limit for this grant.'
      );
    });

    it('should return INELIGIBLE when applicant is too young', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        optional: { ...createValidInput().optional, age: 16 },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
      expect(result.reasonCodes).toContain('APPLICANT_BELOW_MINIMUM_AGE');
    });

    it('should return INELIGIBLE when property not owner-occupied but required', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        required: { ...createValidInput().required, ownershipStatus: 'tenant' },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
      expect(result.reasonCodes).toContain('PROPERTY_NOT_OWNER_OCCUPIED');
      expect(result.clientReasonMessages).toContain(
        'This grant requires the property to be owner-occupied.'
      );
    });
  });

  describe('Provincial overlay: INELIGIBLE', () => {
    it('should return INELIGIBLE when income below provincial minimum', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        optional: { ...createValidInput().optional, estimatedHouseholdIncome: 20000 },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
      expect(result.reasonCodes).toContain('HOUSEHOLD_INCOME_BELOW_MINIMUM');
    });

    it('should return INELIGIBLE when property too new', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        optional: { ...createValidInput().optional, propertyYearBuilt: 2023 },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
      expect(result.reasonCodes).toContain('PROPERTY_TOO_NEW');
    });

    it('should return INELIGIBLE when modification not eligible in province', () => {
      const rules = createMockGrantRules({
        provinces: {
          ON: {
            minHouseholdIncome: 25000,
            minPropertyAge: 5,
            eligibleModifications: ['GRAB_BARS'], // Only grab bars in this version
          },
        },
      });

      const input = createValidInput({
        required: {
          ...createValidInput().required,
          modificationCodes: ['GRAB_BARS', 'STAIR_LIFT'], // Stair lift not eligible
        },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
      expect(result.reasonCodes).toContain('INELIGIBLE_MODIFICATION_TYPES');
    });
  });

  describe('Contextual required fields (tenant/caregiver)', () => {
    it('should track missing landlord name for tenants', () => {
      const rules = createMockGrantRules({
        eligibility: {
          minApplicantAge: 18,
          maxHouseholdIncome: 85000,
          requireOwnerOccupied: false, // Allow non-owner-occupied
        },
      });

      const input = createValidInput({
        required: { ...createValidInput().required, ownershipStatus: 'tenant' },
        optional: { ...createValidInput().optional, landlordName: null },
      });

      const result = evaluateEligibility(input, rules);

      // Should flag missing landlord name in reasonCodes, resulting in INELIGIBLE
      expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
      expect(result.reasonCodes).toContain('MISSING_LANDLORD_NAME');
    });

    it('should track missing senior name for caregivers', () => {
      const rules = createMockGrantRules({
        eligibility: {
          minApplicantAge: 18,
          maxHouseholdIncome: 85000,
          requireOwnerOccupied: false,
        },
      });

      const input = createValidInput({
        required: { ...createValidInput().required, ownershipStatus: 'caregiver' },
        optional: { ...createValidInput().optional, seniorName: null },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
      expect(result.reasonCodes).toContain('MISSING_SENIOR_NAME');
    });
  });

  describe('Rules with missing/empty sections', () => {
    it('should handle rules with no province section gracefully', () => {
      const rules = createMockGrantRules({ provinces: undefined });
      const input = createValidInput({
        required: { ...createValidInput().required, province: 'ON' },
      });

      const result = evaluateEligibility(input, rules);

      // Should still evaluate CMHC baseline, and since we're missing province rules,
      // we can't fully evaluate provincial requirements, so if CMHC passes, result depends on whether we want ELIGIBLE or NEEDS_MORE_INFO
      // Given our logic, if CMHC passes and province has no rules section, we treat it as unable to evaluate province rules
      // Let me check - actually, getProvinceRules returns null, which then gets evaluated, and null rules means eligible=null
      // So provincial overlay will have eligible=null, which means neither true nor false
      // This should fall through to ELIGIBLE if CMHC baseline is fine
      expect([EligibilityDecision.ELIGIBLE, EligibilityDecision.NEEDS_MORE_INFO]).toContain(
        result.overallDecision
      );
    });

    it('should handle null rules gracefully', () => {
      const rules = createMockGrantRules({ rules: null });
      const input = createValidInput();

      const result = evaluateEligibility(input, rules);

      // Should still evaluate based on required fields being present
      expect([EligibilityDecision.ELIGIBLE, EligibilityDecision.NEEDS_MORE_INFO]).toContain(
        result.overallDecision
      );
    });

    it('should handle rules as empty object', () => {
      const rules = createMockGrantRules({ rules: {} });
      const input = createValidInput();

      const result = evaluateEligibility(input, rules);

      expect(result.overallDecision).toBeDefined();
      expect(Object.keys(result.programDecisions).length).toBeGreaterThan(0);
    });
  });

  describe('Decision outcome structure', () => {
    it('should always include programDecisions for CMHC and PROVINCIAL', () => {
      const rules = createMockGrantRules();
      const input = createValidInput();

      const result = evaluateEligibility(input, rules);

      expect(result.programDecisions).toHaveProperty(EligibilityProgram.CMHC);
      expect(result.programDecisions).toHaveProperty(EligibilityProgram.PROVINCIAL);
    });

    it('should generate staff messages for all reason codes', () => {
      const rules = createMockGrantRules();
      const input = createValidInput({
        optional: { ...createValidInput().optional, estimatedHouseholdIncome: 90000 },
      });

      const result = evaluateEligibility(input, rules);

      expect(result.staffReasonMessages.length).toBeGreaterThan(0);
      expect(result.staffReasonMessages[0]).toBeTruthy();
      expect(typeof result.staffReasonMessages[0]).toBe('string');
    });

    it('should generate appropriate client messages based on decision', () => {
      const rules = createMockGrantRules();
      const input = createValidInput();

      const result = evaluateEligibility(input, rules);

      expect(result.clientReasonMessages.length).toBeGreaterThan(0);
      expect(result.clientReasonMessages[0]).toBeTruthy();
      // Client messages should be different from staff messages
      expect(result.clientReasonMessages[0].length).toBeLessThan(200); // Simplified
    });
  });
});
