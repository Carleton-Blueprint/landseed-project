/// <reference types="jest" />

/**
 * Evaluator unit tests
 * Coverage: required fields, province support, owner-occupied baseline,
 * provincial modification overlay, and response structure.
 */

import { evaluateEligibility } from '../evaluator';
import { EligibilityInput, EligibilityDecision, EligibilityProgram } from '../types';
import { GrantRulesVersion } from '@prisma/client';
import { describe, it, expect } from '@jest/globals';

function createMockGrantRules(overrides: Record<string, unknown> = {}): GrantRulesVersion {
  const defaultRules = {
    version: '1.0.0',
    eligibility: {
      requireOwnerOccupied: true,
    },
    provinces: {
      ON: {
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

type InputOverrides = Omit<Partial<EligibilityInput>, 'required' | 'optional'> & {
  required?: Partial<EligibilityInput['required']>;
  optional?: Partial<EligibilityInput['optional']>;
};

function createValidInput(overrides: InputOverrides = {}): EligibilityInput {
  const base: EligibilityInput = {
    project: {
      projectId: 'proj-1',
      projectStatus: 'active',
      address: '123 Main St',
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
      city: 'Toronto',
      postalCode: 'M5V 2T6',
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
    normalization: {
      unknownModificationItems: [],
      duplicateModificationCodes: [],
    },
  };

  return {
    ...base,
    ...overrides,
    required: {
      ...base.required,
      ...(overrides.required ?? {}),
    },
    optional: {
      ...base.optional,
      ...(overrides.optional ?? {}),
    },
  };
}

describe('evaluateEligibility', () => {
  it('returns ELIGIBLE when required data is present and rules pass', () => {
    const result = evaluateEligibility(createValidInput(), createMockGrantRules());
    expect(result.overallDecision).toBe(EligibilityDecision.ELIGIBLE);
    expect(result.programDecisions[EligibilityProgram.CMHC]).toBe(EligibilityDecision.ELIGIBLE);
    expect(result.programDecisions[EligibilityProgram.PROVINCIAL]).toBe(EligibilityDecision.ELIGIBLE);
  });

  it('returns NEEDS_MORE_INFO when assembler flagged missing required fields', () => {
    const input = createValidInput({
      missingRequiredFields: ['PROVINCE'],
      required: { province: null },
    });
    const result = evaluateEligibility(input, createMockGrantRules());
    expect(result.overallDecision).toBe(EligibilityDecision.NEEDS_MORE_INFO);
    expect(result.reasonCodes).toContain('MISSING_REQUIRED_FIELDS');
  });

  it('returns MANUAL_REVIEW for unsupported province', () => {
    const input = createValidInput({ required: { province: 'BC' } });
    const result = evaluateEligibility(input, createMockGrantRules());
    expect(result.overallDecision).toBe(EligibilityDecision.MANUAL_REVIEW);
    expect(result.reasonCodes).toContain('UNSUPPORTED_PROVINCE');
  });

  it('returns INELIGIBLE when owner-occupied is required and applicant is tenant', () => {
    const input = createValidInput({ required: { ownershipStatus: 'tenant' } });
    const result = evaluateEligibility(input, createMockGrantRules());
    expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
    expect(result.reasonCodes).toContain('PROPERTY_NOT_OWNER_OCCUPIED');
  });

  it('returns INELIGIBLE when requested modifications are not in province overlay', () => {
    const rules = createMockGrantRules({
      provinces: {
        ON: {
          eligibleModifications: ['GRAB_BARS'],
        },
      },
    });
    const input = createValidInput({
      required: { modificationCodes: ['GRAB_BARS', 'STAIR_LIFT'] },
    });
    const result = evaluateEligibility(input, rules);
    expect(result.overallDecision).toBe(EligibilityDecision.INELIGIBLE);
    expect(result.reasonCodes).toContain('INELIGIBLE_MODIFICATION_TYPES');
  });

  it('returns staff and client messages', () => {
    const result = evaluateEligibility(createValidInput(), createMockGrantRules());
    expect(result.staffReasonMessages.length).toBeGreaterThan(0);
    expect(result.clientReasonMessages.length).toBeGreaterThan(0);
  });

  it('always includes CMHC and PROVINCIAL program decisions', () => {
    const result = evaluateEligibility(createValidInput(), createMockGrantRules());
    expect(result.programDecisions).toHaveProperty(EligibilityProgram.CMHC);
    expect(result.programDecisions).toHaveProperty(EligibilityProgram.PROVINCIAL);
  });
});
