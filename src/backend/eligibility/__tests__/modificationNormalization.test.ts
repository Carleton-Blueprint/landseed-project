import { describe, expect, it } from "@jest/globals";
import { normalizeModificationItems } from "@/backend/eligibility/modificationNormalization";

describe("normalizeModificationItems", () => {
  it("maps known intake labels to stable internal codes", () => {
    const result = normalizeModificationItems([
      "Grab bars",
      "Raised toilet",
      "Walk-in shower",
      "Widened doorway",
      "Stair lift",
      "Handrails",
    ]);

    expect(result.normalizedCodes).toEqual([
      "GRAB_BARS",
      "RAISED_TOILET",
      "WALK_IN_SHOWER",
      "WIDENED_DOORWAY",
      "STAIR_LIFT",
      "HANDRAILS",
    ]);
    expect(result.unknownItems).toEqual([]);
    expect(result.duplicateCodes).toEqual([]);
  });

  it("handles case and whitespace variants while deduplicating stable codes", () => {
    const result = normalizeModificationItems([
      "  Grab   bars ",
      "grab bars",
      "Walk in shower",
      "walk-in shower",
      "  stair lift",
    ]);

    expect(result.normalizedCodes).toEqual([
      "GRAB_BARS",
      "WALK_IN_SHOWER",
      "STAIR_LIFT",
    ]);
    expect(result.duplicateCodes).toEqual(["GRAB_BARS", "WALK_IN_SHOWER"]);
    expect(result.unknownItems).toEqual([]);
  });

  it("collects unknown items and ignores duplicate unknown labels", () => {
    const result = normalizeModificationItems([
      "Custom ramp",
      "custom ramp",
      "  not a real item ",
      "",
      "   ",
    ]);

    expect(result.normalizedCodes).toEqual([]);
    expect(result.unknownItems).toEqual(["Custom ramp", "not a real item"]);
    expect(result.duplicateCodes).toEqual([]);
  });

  it("supports mixed known and unknown values deterministically", () => {
    const result = normalizeModificationItems([
      "Grab bars",
      "custom rail",
      "Raised toilet",
      "custom rail",
      "raised toilet",
    ]);

    expect(result.normalizedCodes).toEqual(["GRAB_BARS", "RAISED_TOILET"]);
    expect(result.unknownItems).toEqual(["custom rail"]);
    expect(result.duplicateCodes).toEqual(["RAISED_TOILET"]);
  });
});
