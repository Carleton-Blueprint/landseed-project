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

export const ELIGIBILITY_REQUIRED_FIELDS = {
  PROVINCE: "PROVINCE",
  OWNERSHIP_STATUS: "OWNERSHIP_STATUS",
  MODIFICATION_ITEMS: "MODIFICATION_ITEMS",
  CLIENT_CONSENT_CONFIRMED: "CLIENT_CONSENT_CONFIRMED",
  LANDLORD_NAME: "LANDLORD_NAME",
  LANDLORD_PHONE: "LANDLORD_PHONE",
  OWNERSHIP_OTHER_DETAILS: "OWNERSHIP_OTHER_DETAILS",
  SENIOR_NAME: "SENIOR_NAME",
  RELATIONSHIP_TO_SENIOR: "RELATIONSHIP_TO_SENIOR",
  CAREGIVER_CONSENT_CONFIRMED: "CAREGIVER_CONSENT_CONFIRMED",
} as const;

export type EligibilityRequiredField =
  (typeof ELIGIBILITY_REQUIRED_FIELDS)[keyof typeof ELIGIBILITY_REQUIRED_FIELDS];

export type EligibilityOwnershipStatus = "owner" | "tenant" | "other";

export interface EligibilityAssemblerSourceProject {
  id: string;
  status: string;
  address: string;
  draftData: unknown;
}

export interface EligibilityInputProjectSection {
  projectId: string;
  projectStatus: string;
  address: string;
}

export interface EligibilityInputRequiredSection {
  province: string | null;
  ownershipStatus: EligibilityOwnershipStatus | null;
  clientConsentConfirmed: boolean | null;
  modificationCodes: ModificationCode[];
}

export interface EligibilityInputOptionalSection {
  name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  postalCode: string | null;
  ownershipOtherDetails: string | null;
  landlordName: string | null;
  landlordPhone: string | null;
  isCaregiver: boolean;
  seniorName: string | null;
  relationshipToSenior: string | null;
  caregiverConsentConfirmed: boolean | null;
}

export interface EligibilityInput {
  project: EligibilityInputProjectSection;
  required: EligibilityInputRequiredSection;
  optional: EligibilityInputOptionalSection;
  missingRequiredFields: EligibilityRequiredField[];
}
