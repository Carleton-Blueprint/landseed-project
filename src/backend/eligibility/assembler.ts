import { normalizeModificationItems } from "@/backend/eligibility/modificationNormalization";
import {
  ELIGIBILITY_REQUIRED_FIELDS,
  EligibilityAssemblerSourceProject,
  EligibilityInput,
  EligibilityOwnershipStatus,
  EligibilityRequiredField,
} from "@/backend/eligibility/types";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(
  source: Record<string, unknown>,
  key: string
): string | null {
  const value = source[key];

  if (typeof value === "undefined" || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readBoolean(
  source: Record<string, unknown>,
  key: string
): boolean | null {
  const value = source[key];

  if (typeof value === "undefined" || value === null) {
    return null;
  }

  if (typeof value !== "boolean") {
    return null;
  }

  return value;
}

function readOwnershipStatus(
  source: Record<string, unknown>
): EligibilityOwnershipStatus | null {
  const value = source.ownershipStatus;

  if (typeof value === "undefined" || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "owner" || normalized === "tenant" || normalized === "other") {
    return normalized;
  }

  return null;
}

function readModificationItems(
  source: Record<string, unknown>
): string[] {
  const value = source.modificationItems;

  if (typeof value === "undefined" || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const stringItems: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      stringItems.push(item);
    }
  }
  return stringItems;
}

function pushMissing(
  fields: EligibilityRequiredField[],
  field: EligibilityRequiredField
): void {
  if (!fields.includes(field)) {
    fields.push(field);
  }
}

/**
 * Assemble canonical eligibility input from Project + draftData JSON.
 * This function is pure and performs no DB calls.
 */
export function assembleEligibilityInput(
  project: EligibilityAssemblerSourceProject
): EligibilityInput {
  const missingRequiredFields: EligibilityRequiredField[] = [];

  const draft = asRecord(project.draftData);

  const province = readString(draft, "province");
  const ownershipStatus = readOwnershipStatus(draft);
  const clientConsentConfirmed = readBoolean(
    draft,
    "clientConsentConfirmed"
  );

  const modificationItems = readModificationItems(draft);
  const modificationCodes = normalizeModificationItems(modificationItems);

  const optional = {
    name: readString(draft, "name"),
    email: readString(draft, "email"),
    phone: readString(draft, "phone"),
    city: readString(draft, "city"),
    postalCode: readString(draft, "postalCode"),
    ownershipOtherDetails: readString(draft, "ownershipOtherDetails"),
    landlordName: readString(draft, "landlordName"),
    landlordPhone: readString(draft, "landlordPhone"),
    isCaregiver: readBoolean(draft, "isCaregiver") ?? false,
    seniorName: readString(draft, "seniorName"),
    relationshipToSenior: readString(
      draft,
      "relationshipToSenior"
    ),
    caregiverConsentConfirmed: readBoolean(
      draft,
      "caregiverConsentConfirmed"
    ),
  };

  if (!province) {
    pushMissing(missingRequiredFields, ELIGIBILITY_REQUIRED_FIELDS.PROVINCE);
  }

  if (!ownershipStatus) {
    pushMissing(missingRequiredFields, ELIGIBILITY_REQUIRED_FIELDS.OWNERSHIP_STATUS);
  }

  if (modificationCodes.length === 0) {
    pushMissing(missingRequiredFields, ELIGIBILITY_REQUIRED_FIELDS.MODIFICATION_ITEMS);
  }

  if (clientConsentConfirmed !== true) {
    pushMissing(
      missingRequiredFields,
      ELIGIBILITY_REQUIRED_FIELDS.CLIENT_CONSENT_CONFIRMED
    );
  }

  if (ownershipStatus === "tenant") {
    if (!optional.landlordName) {
      pushMissing(missingRequiredFields, ELIGIBILITY_REQUIRED_FIELDS.LANDLORD_NAME);
    }
    if (!optional.landlordPhone) {
      pushMissing(missingRequiredFields, ELIGIBILITY_REQUIRED_FIELDS.LANDLORD_PHONE);
    }
  }

  if (ownershipStatus === "other" && !optional.ownershipOtherDetails) {
    pushMissing(
      missingRequiredFields,
      ELIGIBILITY_REQUIRED_FIELDS.OWNERSHIP_OTHER_DETAILS
    );
  }

  if (optional.isCaregiver) {
    if (!optional.seniorName) {
      pushMissing(missingRequiredFields, ELIGIBILITY_REQUIRED_FIELDS.SENIOR_NAME);
    }
    if (!optional.relationshipToSenior) {
      pushMissing(
        missingRequiredFields,
        ELIGIBILITY_REQUIRED_FIELDS.RELATIONSHIP_TO_SENIOR
      );
    }
    if (optional.caregiverConsentConfirmed !== true) {
      pushMissing(
        missingRequiredFields,
        ELIGIBILITY_REQUIRED_FIELDS.CAREGIVER_CONSENT_CONFIRMED
      );
    }
  }

  return {
    project: {
      projectId: project.id,
      projectStatus: project.status,
      address: project.address,
    },
    required: {
      province,
      ownershipStatus,
      clientConsentConfirmed,
      modificationCodes,
    },
    optional,
    missingRequiredFields,
  };
}
