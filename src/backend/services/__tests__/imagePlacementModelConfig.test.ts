import { PHOTO_ANALYSIS_MODEL_NAME } from "../photoAnalysisModelConfig";
import { computePlacementPlannerCostUsd, getPlacementPlannerModel } from "../imagePlacementModelConfig";

describe("getPlacementPlannerModel", () => {
  const original = process.env.IMAGE_PLACEMENT_AI_MODEL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.IMAGE_PLACEMENT_AI_MODEL;
    } else {
      process.env.IMAGE_PLACEMENT_AI_MODEL = original;
    }
  });

  it("falls back to the photo-analysis model when unset or blank", () => {
    delete process.env.IMAGE_PLACEMENT_AI_MODEL;
    expect(getPlacementPlannerModel()).toBe(PHOTO_ANALYSIS_MODEL_NAME);
    process.env.IMAGE_PLACEMENT_AI_MODEL = "  ";
    expect(getPlacementPlannerModel()).toBe(PHOTO_ANALYSIS_MODEL_NAME);
  });

  it("uses IMAGE_PLACEMENT_AI_MODEL, trimmed", () => {
    process.env.IMAGE_PLACEMENT_AI_MODEL = " gpt-6.1-terra ";
    expect(getPlacementPlannerModel()).toBe("gpt-6.1-terra");
  });
});

describe("computePlacementPlannerCostUsd", () => {
  it("prices prompt and completion tokens per model", () => {
    // gpt-4o-mini: (10_000/1e6)*0.15 + (1_000/1e6)*0.6 = 0.0015 + 0.0006
    expect(computePlacementPlannerCostUsd("gpt-4o-mini", { promptTokens: 10_000, completionTokens: 1_000 })).toBeCloseTo(
      0.0021,
      6
    );
    // gpt-6.1-terra: (10_000/1e6)*1 + (1_000/1e6)*5 = 0.01 + 0.005
    expect(
      computePlacementPlannerCostUsd("gpt-6.1-terra", { promptTokens: 10_000, completionTokens: 1_000 })
    ).toBeCloseTo(0.015, 6);
  });

  it("returns 0 without usage and null for an unpriced model", () => {
    expect(computePlacementPlannerCostUsd("gpt-4o-mini", null)).toBe(0);
    expect(computePlacementPlannerCostUsd("mystery-model", { promptTokens: 1, completionTokens: 1 })).toBeNull();
  });
});
