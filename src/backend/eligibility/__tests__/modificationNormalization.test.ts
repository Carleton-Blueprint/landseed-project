import { describe, expect, it } from "@jest/globals";
import {
  aggregateDeclaredModificationCodes,
  normalizeModificationItems,
  parseDeclaredModificationCodes,
} from "@/backend/eligibility/modificationNormalization";

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

describe("parseDeclaredModificationCodes", () => {
  it("accepts known codes and dedupes", () => {
    const result = parseDeclaredModificationCodes(["GRAB_BARS", "HANDRAILS", "GRAB_BARS"]);

    expect(result).toEqual({ codes: ["GRAB_BARS", "HANDRAILS"], invalidCodes: [] });
  });

  it("reports unknown codes instead of silently dropping them", () => {
    const result = parseDeclaredModificationCodes(["GRAB_BARS", "Grab bars", "not a code"]);

    expect(result).toEqual({
      codes: ["GRAB_BARS"],
      invalidCodes: ["Grab bars", "not a code"],
    });
  });

  it("ignores empty/whitespace-only entries", () => {
    const result = parseDeclaredModificationCodes(["", "   ", "GRAB_BARS"]);

    expect(result).toEqual({ codes: ["GRAB_BARS"], invalidCodes: [] });
  });

  it("returns empty codes for an empty input array", () => {
    const result = parseDeclaredModificationCodes([]);

    expect(result).toEqual({ codes: [], invalidCodes: [] });
  });
});

describe("aggregateDeclaredModificationCodes", () => {
  it("unions codes across photos in canonical order", () => {
    const result = aggregateDeclaredModificationCodes([
      { declaredModificationCodes: ["STAIR_LIFT"] },
      { declaredModificationCodes: ["GRAB_BARS"] },
    ]);

    expect(result).toEqual(["GRAB_BARS", "STAIR_LIFT"]);
  });

  it("dedupes codes shared across multiple photos", () => {
    const result = aggregateDeclaredModificationCodes([
      { declaredModificationCodes: ["GRAB_BARS", "HANDRAILS"] },
      { declaredModificationCodes: ["GRAB_BARS"] },
      { declaredModificationCodes: ["HANDRAILS"] },
    ]);

    expect(result).toEqual(["GRAB_BARS", "HANDRAILS"]);
  });

  it("ignores unrecognized codes rather than throwing", () => {
    const result = aggregateDeclaredModificationCodes([
      { declaredModificationCodes: ["GRAB_BARS", "not a code"] },
    ]);

    expect(result).toEqual(["GRAB_BARS"]);
  });

  it("returns an empty array for photos with no tags", () => {
    const result = aggregateDeclaredModificationCodes([
      { declaredModificationCodes: [] },
      { declaredModificationCodes: [] },
    ]);

    expect(result).toEqual([]);
  });

  it("returns an empty array for zero photos", () => {
    expect(aggregateDeclaredModificationCodes([])).toEqual([]);
  });
});
