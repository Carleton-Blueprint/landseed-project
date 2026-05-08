/**
 * FR-2.6: Manual Review Classifier
 * 
 * Determines if a project should be auto-flagged for manual review based on:
 * - Low-confidence AI analysis (immediate trigger)
 * - High-complexity heuristic signals (conditional trigger)
 * 
 * Trigger Matrix:
 * ┌────────────────┬──────────────┬────────────────────────────────┐
 * │ AI Confidence  │ Complexity   │ Action                         │
 * ├────────────────┼──────────────┼────────────────────────────────┤
 * │ LOW            │ Any          │ Flag as LOW_CONFIDENCE         │
 * │ MEDIUM         │ ≥ 2 signals  │ Flag as HIGH_COMPLEXITY        │
 * │ MEDIUM         │ < 2 signals  │ No flag                        │
 * │ HIGH           │ ≥ 2 signals  │ Flag as HIGH_COMPLEXITY        │
 * │ HIGH           │ < 2 signals  │ No flag                        │
 * └────────────────┴──────────────┴────────────────────────────────┘
 * 
 * Complexity Signals (score 1 point each, need 2+):
 * 1. Multiple modification categories (> 3 unique modification codes)
 * 2. Missing or incomplete critical intake data (> 2 required fields)
 * 3. Conflicting project attributes (mixed ownership, unusual combinations)
 * 4. Low heuristic rule overlap (< 40% of candidates meet criteria)
 * 5. Unusual or rare scope pattern (outlier in grant discovery results)
 */

import {
  ManualReviewClassificationResult,
  ProjectManualReviewReason,
  ComplexitySignals,
  EligibilityInput,
} from './types';

/**
 * Configuration thresholds for complexity classification.
 */
export const COMPLEXITY_CONFIG = {
  /** Minimum number of signals to flag as high-complexity */
  requiredSignalsForComplexity: 2,
  /** Minimum number of modification codes to count as multiple categories */
  modificationThreshold: 3,
  /** Minimum missing fields to count as missing data issue */
  missingFieldThreshold: 2,
  /** Maximum heuristic rule overlap ratio to count as low overlap */
  lowOverlapThreshold: 0.4,
} as const;

/**
 * Analyze a project's eligibility evaluation to determine manual review classification.
 * 
 * @param input - Eligibility assessment input (after discovery/evaluation complete)
 * @param aiConfidence - AI confidence level from discovery (HIGH, MEDIUM, LOW)
 * @param discoveredGrantsCount - Number of grants discovered
 * @param totalCandidatesCount - Total candidates evaluated
 * @returns Classification result with flag decision and reason
 */
export function classifyManualReviewNeed(
  input: EligibilityInput,
  aiConfidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM',
  discoveredGrantsCount: number = 0,
  totalCandidatesCount: number = 0
): ManualReviewClassificationResult {
  // LOW CONFIDENCE = IMMEDIATE TRIGGER (no complexity check needed)
  if (aiConfidence === 'LOW') {
    return {
      reason: ProjectManualReviewReason.LOW_CONFIDENCE,
      shouldFlag: true,
      description: `Low AI confidence detected. Project requires manual review despite evaluation outcome.`,
      aiConfidence: 'LOW',
    };
  }

  // Evaluate complexity signals
  const signals = evaluateComplexitySignals(
    input,
    discoveredGrantsCount,
    totalCandidatesCount
  );
  const complexityScore = countComplexitySignals(signals);

  // If complexity is insufficient, no flag
  if (complexityScore < COMPLEXITY_CONFIG.requiredSignalsForComplexity) {
    return {
      shouldFlag: false,
      description: `Project complexity within normal range. No manual review required.`,
      aiConfidence,
      complexitySignals: signals,
      complexityScore,
    };
  }

  // COMPLEXITY TRIGGER: 2+ signals detected
  return {
    reason: ProjectManualReviewReason.HIGH_COMPLEXITY,
    shouldFlag: true,
    description: `High project complexity detected (${complexityScore}/${countTotalSignals()} signals). 
Requires manual review: ${summarizeSignals(signals).join(', ')}.`,
    aiConfidence,
    complexitySignals: signals,
    complexityScore,
  };
}

/**
 * Evaluate all complexity signals for a project.
 */
function evaluateComplexitySignals(
  input: EligibilityInput,
  discoveredGrantsCount: number,
  totalCandidatesCount: number
): ComplexitySignals {
  return {
    multipleModificationCategories:
      input.required.modificationCodes.length >
      COMPLEXITY_CONFIG.modificationThreshold,

    missingIntakeData:
      input.missingRequiredFields.length >
      COMPLEXITY_CONFIG.missingFieldThreshold,

    conflictingAttributes: hasConflictingAttributes(input),

    unusualScope: isUnusualScope(input),

    lowRuleOverlap:
      totalCandidatesCount > 0 &&
      discoveredGrantsCount / totalCandidatesCount <
        COMPLEXITY_CONFIG.lowOverlapThreshold,
  };
}

/**
 * Check for conflicting or unusual project attributes.
 * Examples: mixed ownership, caregiver without consent, etc.
 */
function hasConflictingAttributes(input: EligibilityInput): boolean {
  const { ownershipStatus, modificationCodes } =
    input.required;
  const {
    isCaregiver,
    landlordName,
    seniorName,
    relationshipToSenior,
    caregiverConsentConfirmed,
  } = input.optional;

  // Caregiver without consent
  if (isCaregiver && !caregiverConsentConfirmed) return true;

  // Tenant scenario with missing landlord info
  if (ownershipStatus === 'tenant' && !landlordName) return true;

  // Senior scenario without proper context
  if (seniorName && !relationshipToSenior) return true;

  // Unusual modification mix (accessibility + major structural)
  const hasAccessibilityMods = modificationCodes.some((code) =>
    ['GRAB_BARS', 'RAISED_TOILET', 'HANDRAILS'].includes(code)
  );
  const hasStructuralMods = modificationCodes.some((code) =>
    ['WIDENED_DOORWAY', 'STAIR_LIFT', 'WALK_IN_SHOWER'].includes(code)
  );
  if (
    hasAccessibilityMods &&
    hasStructuralMods &&
    modificationCodes.length > 4
  ) {
    return true;
  }

  return false;
}

/**
 * Check if the project scope is unusual or rare.
 * Currently a simple heuristic; can be extended with pattern analysis.
 */
function isUnusualScope(input: EligibilityInput): boolean {
  // Province is required; missing it is unusual
  if (!input.required.province) return true;

  // Multiple ownership scenarios are unusual
  if (input.required.ownershipStatus === 'other') return true;

  // Very few or very many modifications is unusual
  const modCount = input.required.modificationCodes.length;
  if (modCount === 0 || modCount > 5) return true;

  return false;
}

/**
 * Count the number of active complexity signals.
 */
function countComplexitySignals(signals: ComplexitySignals): number {
  return Object.values(signals).filter(Boolean).length;
}

/**
 * Count the total number of possible signals.
 */
function countTotalSignals(): number {
  return Object.keys(COMPLEXITY_CONFIG).filter(
    (key) => key !== 'requiredSignalsForComplexity'
  ).length;
}

/**
 * Summarize which signals are active.
 */
function summarizeSignals(signals: ComplexitySignals): string[] {
  const summaries: string[] = [];

  if (signals.multipleModificationCategories) {
    summaries.push('multiple modifications');
  }
  if (signals.missingIntakeData) {
    summaries.push('missing critical data');
  }
  if (signals.conflictingAttributes) {
    summaries.push('conflicting attributes');
  }
  if (signals.unusualScope) {
    summaries.push('unusual scope');
  }
  if (signals.lowRuleOverlap) {
    summaries.push('low grant overlap');
  }

  return summaries;
}

/**
 * Combine LOW_CONFIDENCE and HIGH_COMPLEXITY reasons if both are present.
 * (Used when re-evaluating an existing project with both conditions met.)
 */
export function combineReasons(
  hasLowConfidence: boolean,
  hasHighComplexity: boolean
): ProjectManualReviewReason {
  if (hasLowConfidence && hasHighComplexity) {
    return ProjectManualReviewReason.BOTH;
  }
  if (hasLowConfidence) {
    return ProjectManualReviewReason.LOW_CONFIDENCE;
  }
  if (hasHighComplexity) {
    return ProjectManualReviewReason.HIGH_COMPLEXITY;
  }
  // Default (should not be called without at least one true)
  return ProjectManualReviewReason.LOW_CONFIDENCE;
}
