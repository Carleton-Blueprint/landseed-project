import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  computeImageGenerationCostUsd,
  getImageGenerationModel,
} from "../imageGenerationModelConfig";

describe("getImageGenerationModel", () => {
  const original = process.env.IMAGE_GENERATION_MODEL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.IMAGE_GENERATION_MODEL;
    } else {
      process.env.IMAGE_GENERATION_MODEL = original;
    }
  });

  it("defaults when unset or blank", () => {
    delete process.env.IMAGE_GENERATION_MODEL;
    expect(getImageGenerationModel()).toBe(DEFAULT_IMAGE_GENERATION_MODEL);
    process.env.IMAGE_GENERATION_MODEL = "   ";
    expect(getImageGenerationModel()).toBe(DEFAULT_IMAGE_GENERATION_MODEL);
  });

  it("uses the configured model, trimmed", () => {
    process.env.IMAGE_GENERATION_MODEL = " gpt-image-2.6-flare ";
    expect(getImageGenerationModel()).toBe("gpt-image-2.6-flare");
  });

  it("does not default to the shut-down gpt-image-1", () => {
    expect(DEFAULT_IMAGE_GENERATION_MODEL).not.toBe("gpt-image-1");
  });
});

describe("computeImageGenerationCostUsd", () => {
  it("prices text input, image input and image output per model", () => {
    // (500/1e6)*5 + (200/1e6)*8 + (1000/1e6)*30 = 0.0025 + 0.0016 + 0.03
    expect(
      computeImageGenerationCostUsd("gpt-image-2.6-sunburst", {
        output_tokens: 1000,
        input_tokens_details: { text_tokens: 500, image_tokens: 200 },
      })
    ).toBeCloseTo(0.0341, 6);

    // (500/1e6)*2 + (200/1e6)*2.5 + (1000/1e6)*8 = 0.001 + 0.0005 + 0.008
    expect(
      computeImageGenerationCostUsd("gpt-image-1-mini", {
        output_tokens: 1000,
        input_tokens_details: { text_tokens: 500, image_tokens: 200 },
      })
    ).toBeCloseTo(0.0095, 6);
  });

  it("splits output into image and text tokens when the breakdown is present", () => {
    // gpt-image-1.5: (900/1e6)*32 + (100/1e6)*10 = 0.0288 + 0.001
    expect(
      computeImageGenerationCostUsd("gpt-image-1.5", {
        output_tokens: 1000,
        output_tokens_details: { image_tokens: 900, text_tokens: 100 },
      })
    ).toBeCloseTo(0.0298, 6);
  });

  it("returns 0 without usage and null for an unpriced model", () => {
    expect(computeImageGenerationCostUsd("gpt-image-2", undefined)).toBe(0);
    expect(computeImageGenerationCostUsd("gpt-image-1", { output_tokens: 1000 })).toBeNull();
  });
});
