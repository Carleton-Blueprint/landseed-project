type PhotoAnalysisModelConfig = typeof import("../photoAnalysisModelConfig");
type PlacementModelConfig = typeof import("../imagePlacementModelConfig");

// The model name is read at import time, so each case loads a fresh module.
function loadWithEnv(env: Record<string, string | undefined>): {
  photo: PhotoAnalysisModelConfig;
  placement: PlacementModelConfig;
} {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  let photo!: PhotoAnalysisModelConfig;
  let placement!: PlacementModelConfig;
  jest.isolateModules(() => {
    photo = jest.requireActual("../photoAnalysisModelConfig");
    placement = jest.requireActual("../imagePlacementModelConfig");
  });
  return { photo, placement };
}

describe("photo analysis model defaults", () => {
  const keys = ["PHOTO_ANALYSIS_AI_MODEL", "PHOTO_ANALYSIS_AI_REASONING_EFFORT", "IMAGE_PLACEMENT_AI_MODEL"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    loadWithEnv(original);
  });

  it("defaults to gpt-6.1-terra with no reasoning effort", () => {
    const { photo } = loadWithEnv({ PHOTO_ANALYSIS_AI_MODEL: undefined, PHOTO_ANALYSIS_AI_REASONING_EFFORT: undefined });
    expect(photo.PHOTO_ANALYSIS_MODEL_NAME).toBe("gpt-6.1-terra");
    expect(photo.getPhotoAnalysisReasoningEffort()).toBeNull();
  });

  it("treats a blank PHOTO_ANALYSIS_AI_MODEL as unset and trims overrides", () => {
    expect(loadWithEnv({ PHOTO_ANALYSIS_AI_MODEL: "  " }).photo.PHOTO_ANALYSIS_MODEL_NAME).toBe("gpt-6.1-terra");
    expect(loadWithEnv({ PHOTO_ANALYSIS_AI_MODEL: " gpt-6-luna " }).photo.PHOTO_ANALYSIS_MODEL_NAME).toBe("gpt-6-luna");
  });

  it("makes the placement planner fall back to gpt-6.1-terra when nothing is set", () => {
    const { placement } = loadWithEnv({ PHOTO_ANALYSIS_AI_MODEL: undefined, IMAGE_PLACEMENT_AI_MODEL: undefined });
    expect(placement.getPlacementPlannerModel()).toBe("gpt-6.1-terra");
  });
});
