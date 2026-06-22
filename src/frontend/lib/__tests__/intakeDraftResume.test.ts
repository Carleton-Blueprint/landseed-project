import {
  getResumeScrollTargetId,
  isGuidedSectionComplete,
} from "../intakeDraftResume";

describe("intakeDraftResume", () => {
  describe("isGuidedSectionComplete", () => {
    it("returns false when guided data is missing required fields", () => {
      expect(isGuidedSectionComplete(null)).toBe(false);
      expect(isGuidedSectionComplete({ mobilityAssistance: "yes" })).toBe(false);
    });

    it("returns true when all guided fields are present", () => {
      expect(
        isGuidedSectionComplete({
          mobilityAssistance: "yes",
          safetyFeatures: ["grab-bars"],
          bathroomModifications: "yes",
          urgency: "soon",
        })
      ).toBe(true);
    });
  });

  describe("getResumeScrollTargetId", () => {
    it("scrolls to guided intake when guided section is incomplete", () => {
      expect(getResumeScrollTargetId({ mobilityAssistance: "yes" })).toBe("guided-intake");
    });

    it("scrolls to intake form when guided section is complete", () => {
      expect(
        getResumeScrollTargetId({
          mobilityAssistance: "yes",
          safetyFeatures: ["grab-bars"],
          bathroomModifications: "yes",
          urgency: "soon",
        })
      ).toBe("intake-form");
    });
  });
});
