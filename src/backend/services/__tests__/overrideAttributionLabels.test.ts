import {
  CLIENT_OVERRIDE_LABEL,
  FORMER_STAFF_LABEL,
  displayStaffName,
  formatAssessmentAttribution,
  formatPostEstimateOverride,
} from "../overrideAttributionLabels";

const fmt = (iso: string) => iso.slice(0, 10);

describe("overrideAttributionLabels", () => {
  describe("displayStaffName", () => {
    it("prefers the name, then the email", () => {
      expect(displayStaffName({ name: "Dana Admin", email: "dana@example.com" })).toBe("Dana Admin");
      expect(displayStaffName({ name: null, email: "dana@example.com" })).toBe("dana@example.com");
    });

    it("falls back to 'a former staff member' for an anonymized or missing user", () => {
      expect(displayStaffName({ name: null, email: null })).toBe(FORMER_STAFF_LABEL);
      expect(displayStaffName({ name: "  ", email: null })).toBe(FORMER_STAFF_LABEL);
      expect(displayStaffName(null)).toBe(FORMER_STAFF_LABEL);
    });
  });

  describe("formatAssessmentAttribution", () => {
    const base = { adminName: "Dana Admin", at: "2026-10-30T15:00:00.000Z", stage: "pre-estimate" as const };

    it("labels a pre-estimate override", () => {
      expect(formatAssessmentAttribution({ ...base, adminAction: "PRE_ESTIMATE_OVERRIDE" }, fmt)).toBe(
        "Pre-estimate override by Dana Admin on 2026-10-30"
      );
    });

    it("labels manual grants", () => {
      expect(formatAssessmentAttribution({ ...base, adminAction: "MANUAL_GRANTS" }, fmt)).toBe(
        "Manual grants entered by Dana Admin on 2026-10-30"
      );
    });

    it("labels a re-assess with its stage", () => {
      expect(formatAssessmentAttribution({ ...base, adminAction: "REASSESS" }, fmt)).toBe(
        "Re-assessed by Dana Admin on 2026-10-30 (pre-estimate)"
      );
      expect(formatAssessmentAttribution({ ...base, adminAction: "REASSESS", stage: "post-estimate" }, fmt)).toBe(
        "Re-assessed by Dana Admin on 2026-10-30 (post-estimate)"
      );
    });
  });

  describe("formatPostEstimateOverride", () => {
    const base = { adminName: "Sam Staff", at: "2026-10-29T09:00:00.000Z", history: [] };

    it("omits the edit count for a single override", () => {
      expect(formatPostEstimateOverride({ ...base, editCount: 1 }, fmt)).toBe(
        "Post-estimate override by Sam Staff on 2026-10-29"
      );
    });

    it("appends the edit count when overridden more than once", () => {
      expect(formatPostEstimateOverride({ ...base, editCount: 3 }, fmt)).toBe(
        "Post-estimate override by Sam Staff on 2026-10-29 (edited 3 times)"
      );
    });
  });

  it("keeps the client label free of names and override type", () => {
    expect(CLIENT_OVERRIDE_LABEL).toBe("Overridden by LandSeed staff");
  });
});
