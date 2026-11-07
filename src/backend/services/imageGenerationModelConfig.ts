/**
 * Image model selection and per-model pricing for accessibility renditions.
 *
 * IMAGE_GENERATION_MODEL picks the images.edit model (worker service only —
 * the worker is what runs generation jobs). gpt-image-1 was shut down by
 * OpenAI on 2026-10-23, which is why it's no longer the default or priced
 * here; see https://developers.openai.com/api/docs/deprecations.
 */

export const DEFAULT_IMAGE_GENERATION_MODEL = "gpt-image-2.6-sunburst";

/** USD per 1,000,000 tokens, from https://developers.openai.com/api/docs/pricing (checked 2026-11-07). */
export interface ImageModelPrice {
  textInput: number;
  imageInput: number;
  imageOutput: number;
  textOutput: number;
}

const GPT_IMAGE_2_FAMILY_PRICE: ImageModelPrice = { textInput: 5, imageInput: 8, imageOutput: 30, textOutput: 0 };

export const IMAGE_MODEL_PRICES_PER_MILLION_TOKENS_USD: Record<string, ImageModelPrice> = {
  "gpt-image-2": GPT_IMAGE_2_FAMILY_PRICE,
  "gpt-image-2.5-sunburst": GPT_IMAGE_2_FAMILY_PRICE,
  "gpt-image-2.5-flare": GPT_IMAGE_2_FAMILY_PRICE,
  "gpt-image-2.6-sunburst": GPT_IMAGE_2_FAMILY_PRICE,
  "gpt-image-2.6-flare": GPT_IMAGE_2_FAMILY_PRICE,
  // Both shut down 2026-12-01.
  "gpt-image-1.5": { textInput: 5, imageInput: 8, imageOutput: 32, textOutput: 10 },
  "gpt-image-1-mini": { textInput: 2, imageInput: 2.5, imageOutput: 8, textOutput: 0 },
};

export function getImageGenerationModel(): string {
  return process.env.IMAGE_GENERATION_MODEL?.trim() || DEFAULT_IMAGE_GENERATION_MODEL;
}

export interface ImageEditUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  output_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

export function roundCostUsd(cost: number): number {
  return Math.round(cost * 10_000) / 10_000;
}

/**
 * Returns null when the model has no known price, so an unpriced model shows
 * up as "cost unknown" in the audit trail instead of silently costing $0.
 * Returns 0 when the model is priced but the response carried no usage.
 */
export function computeImageGenerationCostUsd(model: string, usage: ImageEditUsage | undefined): number | null {
  const price = IMAGE_MODEL_PRICES_PER_MILLION_TOKENS_USD[model];
  if (!price) {
    return null;
  }
  if (!usage) {
    return 0;
  }

  const textInputTokens = usage.input_tokens_details?.text_tokens ?? 0;
  const imageInputTokens = usage.input_tokens_details?.image_tokens ?? 0;
  // Without an output breakdown, every output token is an image token.
  const textOutputTokens = usage.output_tokens_details?.text_tokens ?? 0;
  const imageOutputTokens = usage.output_tokens_details?.image_tokens ?? usage.output_tokens ?? 0;

  return roundCostUsd(
    (textInputTokens / 1_000_000) * price.textInput +
      (imageInputTokens / 1_000_000) * price.imageInput +
      (imageOutputTokens / 1_000_000) * price.imageOutput +
      (textOutputTokens / 1_000_000) * price.textOutput
  );
}
