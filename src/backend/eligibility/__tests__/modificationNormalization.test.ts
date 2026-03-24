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

    expect(result).toEqual([
      "GRAB_BARS",
      "RAISED_TOILET",
      "WALK_IN_SHOWER",
      "WIDENED_DOORWAY",
      "STAIR_LIFT",
      "HANDRAILS",
    ]);
  });

  it("handles case and whitespace variants while deduplicating", () => {
    const result = normalizeModificationItems([
      "  Grab   bars ",
      "grab bars",
      "Walk in shower",
      "walk-in shower",
      "  stair lift",
    ]);

    expect(result).toEqual([
      "GRAB_BARS",
      "WALK_IN_SHOWER",
      "STAIR_LIFT",
    ]);
  });

  it("ignores empty strings and unknown items", () => {
    const result = normalizeModificationItems([
      "Custom ramp",
      "custom ramp",
      "  not a real item ",
      "",
      "   ",
    ]);

    expect(result).toEqual([]);
  });

  it("deduplicates across mixed known items", () => {
    const result = normalizeModificationItems([
      "Grab bars",
      "custom rail",
      "Raised toilet",
      "custom rail",
      "raised toilet",
    ]);

    expect(result).toEqual(["GRAB_BARS", "RAISED_TOILET"]);
  });
});
