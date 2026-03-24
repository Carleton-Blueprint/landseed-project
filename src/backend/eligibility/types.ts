export enum EligibilityDecision {
  ELIGIBLE = "ELIGIBLE",
  INELIGIBLE = "INELIGIBLE",
  NEEDS_MORE_INFO = "NEEDS_MORE_INFO",
  MANUAL_REVIEW = "MANUAL_REVIEW",
}

export enum EligibilityProgram {
  CMHC = "CMHC",
  PROVINCIAL = "PROVINCIAL",
}

export const ELIGIBILITY_REASON_CODES = {
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  UNSUPPORTED_PROVINCE: "UNSUPPORTED_PROVINCE",
  MODIFICATION_NOT_COVERED: "MODIFICATION_NOT_COVERED",
  MODIFICATION_ITEM_UNKNOWN: "MODIFICATION_ITEM_UNKNOWN",
  DUPLICATE_MODIFICATION_ITEM: "DUPLICATE_MODIFICATION_ITEM",
  OWNER_OCCUPANCY_REQUIRED: "OWNER_OCCUPANCY_REQUIRED",
  TENANT_LANDLORD_CONSENT_REQUIRED: "TENANT_LANDLORD_CONSENT_REQUIRED",
  CAREGIVER_CONSENT_REQUIRED: "CAREGIVER_CONSENT_REQUIRED",
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  RULESET_REQUIRES_MANUAL_REVIEW: "RULESET_REQUIRES_MANUAL_REVIEW",
} as const;

export type EligibilityReasonCode =
  (typeof ELIGIBILITY_REASON_CODES)[keyof typeof ELIGIBILITY_REASON_CODES];

export const MODIFICATION_CODES = {
  GRAB_BARS: "GRAB_BARS",
  RAISED_TOILET: "RAISED_TOILET",
  WALK_IN_SHOWER: "WALK_IN_SHOWER",
  WIDENED_DOORWAY: "WIDENED_DOORWAY",
  STAIR_LIFT: "STAIR_LIFT",
  HANDRAILS: "HANDRAILS",
} as const;

export type ModificationCode =
  (typeof MODIFICATION_CODES)[keyof typeof MODIFICATION_CODES];

export interface EligibilityProgramDecision {
  program: EligibilityProgram;
  decision: EligibilityDecision;
  reasonCodes: EligibilityReasonCode[];
}

export interface EligibilityResult {
  decision: EligibilityDecision;
  reasonCodes: EligibilityReasonCode[];
  programDecisions: EligibilityProgramDecision[];
}

export interface NormalizedModificationItemsResult {
  normalizedCodes: ModificationCode[];
  unknownItems: string[];
  duplicateCodes: ModificationCode[];
}
