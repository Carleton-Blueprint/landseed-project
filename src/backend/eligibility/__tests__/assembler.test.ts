import { describe, expect, it } from "@jest/globals";
import { assembleEligibilityInput } from "@/backend/eligibility/assembler";

describe("assembleEligibilityInput", () => {
  it("builds normalized eligibility input for complete draft data", () => {
    const result = assembleEligibilityInput({
      id: "proj_1",
      status: "draft",
      address: "123 Main St, Toronto, ON",
      draftData: {
        name: "Alex Client",
        email: "alex@example.com",
        phone: "555-0100",
        city: "Toronto",
        province: "on",
        postalCode: "M5V 2T6",
        ownershipStatus: "owner",
        isCaregiver: false,
        clientConsentConfirmed: true,
        modificationItems: ["Grab bars", "Walk-in shower"],
      },
    });

    expect(result.project).toEqual({
      projectId: "proj_1",
      projectStatus: "draft",
      address: "123 Main St, Toronto, ON",
    });

    expect(result.required).toEqual({
      province: "ON",
      ownershipStatus: "owner",
      clientConsentConfirmed: true,
      modificationCodes: ["GRAB_BARS", "WALK_IN_SHOWER"],
    });

    expect(result.optional.isCaregiver).toBe(false);
    expect(result.missingRequiredFields).toEqual([]);
    expect(result.malformedDraftFields).toEqual([]);
  });

  it("detects missing required fields for partial draft data", () => {
    const result = assembleEligibilityInput({
      id: "proj_2",
      status: "draft",
      address: "Draft address",
      draftData: {
        province: "",
        ownershipStatus: "tenant",
        landlordName: "",
        isCaregiver: true,
        seniorName: "",
        relationshipToSenior: "daughter",
        caregiverConsentConfirmed: false,
        clientConsentConfirmed: false,
        modificationItems: [],
      },
    });

    expect(result.required.province).toBeNull();
    expect(result.required.ownershipStatus).toBe("tenant");
    expect(result.required.modificationCodes).toEqual([]);

    expect(result.missingRequiredFields).toEqual([
      "PROVINCE",
      "MODIFICATION_ITEMS",
      "CLIENT_CONSENT_CONFIRMED",
      "LANDLORD_NAME",
      "LANDLORD_PHONE",
      "SENIOR_NAME",
      "CAREGIVER_CONSENT_CONFIRMED",
    ]);

    expect(result.malformedDraftFields).toEqual([]);
  });

  it("handles malformed draftData while preserving valid values", () => {
    const result = assembleEligibilityInput({
      id: "proj_3",
      status: "draft",
      address: "Draft address",
      draftData: {
        province: 123,
        ownershipStatus: "invalid",
        clientConsentConfirmed: "yes",
        isCaregiver: "true",
        caregiverConsentConfirmed: "no",
        modificationItems: ["Grab bars", 22, null, "Unknown custom item", "Grab bars"],
        landlordPhone: 1000,
      },
    });

    expect(result.required.province).toBeNull();
    expect(result.required.ownershipStatus).toBeNull();
    expect(result.required.clientConsentConfirmed).toBeNull();
    expect(result.required.modificationCodes).toEqual(["GRAB_BARS"]);

    expect(result.malformedDraftFields).toEqual([
      "province",
      "ownershipStatus",
      "clientConsentConfirmed",
      "modificationItems",
      "landlordPhone",
      "isCaregiver",
      "caregiverConsentConfirmed",
    ]);

    expect(result.missingRequiredFields).toEqual([
      "PROVINCE",
      "OWNERSHIP_STATUS",
      "CLIENT_CONSENT_CONFIRMED",
    ]);
  });
});
