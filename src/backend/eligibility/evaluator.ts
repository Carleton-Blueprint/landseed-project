/**
 * FR-3.1 Eligibility Evaluator
 * 
 * Pure function to deterministically evaluate grant eligibility based on:
 * - CMHC baseline rules (all provinces)
 * - Provincial overlay rules (when available)
 * - Required vs optional field completeness
 * 
 * Returns EligibilityDecision with reason codes and staff/client messages.
 */

import {
  EligibilityInput,
  EligibilityDecision,
  EligibilityProgram,
} from './types';
import { GrantRulesVersion } from '@prisma/client';

type RulesObject = {
  eligibility?: {
    requireOwnerOccupied?: boolean;
  };
  provinces?: Record<
    string,
    {
      eligibleModifications?: string[];
    }
  >;
};

export interface EvaluationResult {
  overallDecision: EligibilityDecision;
  programDecisions: Record<EligibilityProgram, EligibilityDecision>;
  reasonCodes: string[];
  staffReasonMessages: string[];
  clientReasonMessages: string[];
  missingRequirements: string[];
}

/**
 * Check if required fields are present
 */
function validateRequiredFields(input: EligibilityInput): {
  valid: boolean;
  missingFields: string[];
} {
  const missing = input.missingRequiredFields.map(String);

  return {
    valid: missing.length === 0,
    missingFields: missing,
  };
}

/**
 * Check if province is supported for eligibility evaluation
 * Initially only ON (Ontario) is enabled
 */
function isProvinceSupported(province: string | null): boolean {
  const supportedProvinces = ['ON']; // Phase 1: Ontario only
  return supportedProvinces.includes(province?.toUpperCase() || '');
}

/**
 * Get provincial rules from the grant rules version
 */
function getProvinceRules(rules: RulesObject, province: string | null) {
  if (!province) {
    return null;
  }
  if (!rules.provinces || typeof rules.provinces !== 'object') {
    return null;
  }
  return rules.provinces[province?.toUpperCase()];
}

/**
 * CMHC baseline eligibility check
 * All provinces must pass these baseline requirements
 */
function evaluateCmhcBaseline(input: EligibilityInput, rules: RulesObject): {
  eligible: boolean;
  reasonCodes: string[];
} {
  const reasonCodes: string[] = [];

  // Check consent is confirmed
  if (!input.required.clientConsentConfirmed) {
    reasonCodes.push('CONSENT_NOT_CONFIRMED');
  }

  // Check property type (if specified in rules)
  if (rules.eligibility?.requireOwnerOccupied && 
      input.required.ownershipStatus === 'tenant') {
    reasonCodes.push('PROPERTY_NOT_OWNER_OCCUPIED');
  }

  // Check contextual required fields
  if (input.required.ownershipStatus === 'tenant' && !input.optional.landlordName) {
    reasonCodes.push('MISSING_LANDLORD_NAME');
  }
  if (input.optional.isCaregiver && !input.optional.seniorName) {
    reasonCodes.push('MISSING_SENIOR_NAME');
  }

  return {
    eligible: reasonCodes.length === 0,
    reasonCodes,
  };
}

/**
 * Provincial overlay evaluation (when province is supported)
 */
function evaluateProvinceOverlay(
  input: EligibilityInput,
  provinceRules: { eligibleModifications?: string[] } | null
): {
  eligible: boolean | null; // null = skip if missing rules
  reasonCodes: string[];
} {
  if (!provinceRules || typeof provinceRules !== 'object') {
    return { eligible: null, reasonCodes: [] };
  }

  const reasonCodes: string[] = [];

  // Check eligible modifications (if specified)
  if (Array.isArray(provinceRules.eligibleModifications) &&
      input.required.modificationCodes) {
    const eligibleModifications = provinceRules.eligibleModifications;
    const ineligibleMods = input.required.modificationCodes.filter(
      (code) => !eligibleModifications.includes(code)
    );
    if (ineligibleMods.length > 0) {
      reasonCodes.push('INELIGIBLE_MODIFICATION_TYPES');
    }
  }

  return {
    eligible: reasonCodes.length === 0,
    reasonCodes,
  };
}

/**
 * Combine CMHC + provincial results into final decision
 */
function synthesizeDecision(
  requiredFieldsValid: boolean,
  provinceSupported: boolean,
  cmhcBaseline: { eligible: boolean; reasonCodes: string[] },
  provinceOverlay: { eligible: boolean | null; reasonCodes: string[] },
  input: EligibilityInput
): {
  decision: EligibilityDecision;
  allReasonCodes: string[];
  allMissingRequirements: string[];
} {
  const allReasonCodes: string[] = [];
  const allMissingRequirements: string[] = [];

  // Step 1: Check required fields
  if (!requiredFieldsValid) {
    if (input.missingRequiredFields && input.missingRequiredFields.length > 0) {
      allMissingRequirements.push(...input.missingRequiredFields);
    }
    allReasonCodes.push('MISSING_REQUIRED_FIELDS');
    return {
      decision: EligibilityDecision.NEEDS_MORE_INFO,
      allReasonCodes,
      allMissingRequirements,
    };
  }

  // Step 2: Check if province is supported
  if (!provinceSupported) {
    allReasonCodes.push('UNSUPPORTED_PROVINCE');
    return {
      decision: EligibilityDecision.MANUAL_REVIEW,
      allReasonCodes,
      allMissingRequirements,
    };
  }

  // Step 3: Evaluate CMHC baseline
  allReasonCodes.push(...cmhcBaseline.reasonCodes);

  if (!cmhcBaseline.eligible) {
    return {
      decision: EligibilityDecision.INELIGIBLE,
      allReasonCodes,
      allMissingRequirements,
    };
  }

  // Step 4: Evaluate provincial overlay
  allReasonCodes.push(...provinceOverlay.reasonCodes);

  if (provinceOverlay.eligible === false) {
    return {
      decision: EligibilityDecision.INELIGIBLE,
      allReasonCodes,
      allMissingRequirements,
    };
  }

  // Step 5: Final decision
  // ALL checks passed - we're eligible
  return {
    decision: EligibilityDecision.ELIGIBLE,
    allReasonCodes: allReasonCodes.length > 0 ? allReasonCodes : ['ALL_REQUIREMENTS_MET'],
    allMissingRequirements,
  };
}

/**
 * Staff-facing reason messages (detailed, internal)
 */
function getStaffReasonMessages(reasonCodes: string[]): string[] {
  return reasonCodes.map((code) => {
    switch (code) {
      case 'MISSING_REQUIRED_FIELDS':
        return 'Required fields are missing from the application.';
      case 'CONSENT_NOT_CONFIRMED':
        return 'Applicant consent has not been confirmed.';
      case 'UNSUPPORTED_PROVINCE':
        return 'The applicant\'s province is not yet supported for automated eligibility evaluation.';
      case 'HOUSEHOLD_INCOME_EXCEEDS_LIMIT':
        return 'Household income exceeds the CMHC limit.';
      case 'HOUSEHOLD_INCOME_BELOW_MINIMUM':
        return 'Household income is below the provincial minimum.';
      case 'APPLICANT_BELOW_MINIMUM_AGE':
        return 'Applicant is below the minimum age requirement.';
      case 'PROPERTY_NOT_OWNER_OCCUPIED':
        return 'Property must be owner-occupied for this grant.';
      case 'PROPERTY_TOO_NEW':
        return 'Property is too new to qualify for this grant.';
      case 'INELIGIBLE_MODIFICATION_TYPES':
        return 'One or more requested modifications are not eligible in this province.';
      case 'INCOMPLETE_OPTIONAL_FIELDS':
        return 'Optional fields are incomplete; additional information could strengthen the application.';
      case 'MISSING_LANDLORD_NAME':
        return 'Landlord name is required for tenant applications.';
      case 'MISSING_SENIOR_NAME':
        return 'Senior name is required for caregiver applications.';
      case 'ALL_REQUIREMENTS_MET':
        return 'All eligibility requirements have been met.';
      default:
        return `Eligibility issue: ${code}`;
    }
  });
}

/**
 * Client-facing reason messages (simplified, external)
 */
function getClientReasonMessages(reasonCodes: string[], decision: EligibilityDecision): string[] {
  // Only show simplified messages for final decision, not internal reasons
  switch (decision) {
    case EligibilityDecision.ELIGIBLE:
      return ['Congratulations! You appear to be eligible for this grant.'];
    case EligibilityDecision.INELIGIBLE:
      if (reasonCodes.includes('HOUSEHOLD_INCOME_EXCEEDS_LIMIT')) {
        return ['Your household income exceeds the current limit for this grant.'];
      }
      if (reasonCodes.includes('PROPERTY_NOT_OWNER_OCCUPIED')) {
        return ['This grant requires the property to be owner-occupied.'];
      }
      return ['Unfortunately, you do not meet the eligibility requirements for this grant.'];
    case EligibilityDecision.NEEDS_MORE_INFO:
      return ['We need additional information to determine your eligibility. Please complete your application.'];
    case EligibilityDecision.MANUAL_REVIEW:
      return ['Your application requires manual review. A staff member will contact you shortly.'];
    default:
      return ['Your eligibility status is being reviewed.'];
  }
}

/**
 * Main evaluator function
 * Pure function: no side effects, deterministic output
 */
export function evaluateEligibility(
  input: EligibilityInput,
  grantRulesVersion: GrantRulesVersion
): EvaluationResult {
  const rules: RulesObject =
    grantRulesVersion.rules && typeof grantRulesVersion.rules === 'object'
      ? (grantRulesVersion.rules as RulesObject)
      : {};

  // Validate required fields
  const requiredValidation = validateRequiredFields(input);

  // Check province support
  const provinceSupported = isProvinceSupported(input.required.province);

  // Evaluate CMHC baseline (always, regardless of province)
  const cmhcBaseline = evaluateCmhcBaseline(input, rules);

  // Evaluate provincial overlay (only if province is supported)
  let provinceOverlay: { eligible: boolean | null; reasonCodes: string[] } = {
    eligible: null,
    reasonCodes: [],
  };
  if (provinceSupported) {
    const provinceRules = getProvinceRules(rules, input.required.province);
    provinceOverlay = evaluateProvinceOverlay(input, provinceRules);
  }

  // Synthesize final decision
  const synthesis = synthesizeDecision(
    requiredValidation.valid,
    provinceSupported,
    cmhcBaseline,
    provinceOverlay,
    input
  );

  // Generate client and staff messages
  const staffMessages = getStaffReasonMessages(synthesis.allReasonCodes);
  const clientMessages = getClientReasonMessages(synthesis.allReasonCodes, synthesis.decision);

  return {
    overallDecision: synthesis.decision,
    programDecisions: {
      [EligibilityProgram.CMHC]: cmhcBaseline.eligible ? EligibilityDecision.ELIGIBLE : EligibilityDecision.INELIGIBLE,
      [EligibilityProgram.PROVINCIAL]: provinceSupported
        ? (provinceOverlay.eligible === false ? EligibilityDecision.INELIGIBLE : EligibilityDecision.ELIGIBLE)
        : EligibilityDecision.MANUAL_REVIEW,
    },
    reasonCodes: synthesis.allReasonCodes,
    staffReasonMessages: staffMessages,
    clientReasonMessages: clientMessages,
    missingRequirements:
      synthesis.allMissingRequirements.length > 0
        ? synthesis.allMissingRequirements
        : requiredValidation.missingFields,
  };
}
