/**
 * Image generation for accessibility modification visualizations.
 *
 * generateAccessibilityVisual() is the live path: it sends the client's original
 * photo plus the identified modification types to OpenAI's gpt-image-1 edit
 * endpoint and stores the result in S3. generateMockAccessibilityVisual() remains
 * as the fallback used when LIVE_IMAGE_GENERATION_ENABLED is not "true".
 */
import { randomUUID } from "node:crypto";
import { toFile } from "openai";
import { getOpenAIClient } from "lib/openai";
import { getSignedDownloadUrlFromS3Url, uploadStreamToS3 } from "lib/s3";

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 600;
const DEFAULT_BG_COLOR = "efefef";
const DEFAULT_TEXT_COLOR = "333";

const MODIFICATION_LABELS: Record<string, string> = {
  GRAB_BARS: "Grab Bars",
  RAISED_TOILET: "Raised Toilet",
  WALK_IN_SHOWER: "Walk-In Shower",
  WIDENED_DOORWAY: "Widened Doorway",
  STAIR_LIFT: "Stair Lift",
  HANDRAILS: "Handrails",
};

function formatModificationLabel(codes: string[]): string {
  if (codes.length === 0) {
    return "Accessibility+Visual";
  }

  const labels = codes
    .map((code) => MODIFICATION_LABELS[code] ?? code.replace(/_/g, " "))
    .slice(0, 3);

  return labels.join("+");
}

function buildPlaceholderText(codes: string[]): string {
  const label = formatModificationLabel(codes);
  return `Mock+AI+Visual+for+${encodeURIComponent(label)}`;
}

export function buildMockAccessibilityVisualPrompt(
  sourceImageUrl: string,
  modificationCodes: string[] = []
): string {
  const modifications = modificationCodes.length
    ? modificationCodes.join(", ")
    : "general accessibility improvements";

  return `Generate a visual mockup of the source image (${sourceImageUrl}) showing proposed accessibility modifications: ${modifications}. Use a clean, easy-to-read representation that illustrates the requested changes without producing a real photo.`;
}

export async function generateMockAccessibilityVisual(
  sourceImageUrl: string,
  options?: {
    modificationCodes?: string[];
    width?: number;
    height?: number;
  }
): Promise<string> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;
  const placeholderText = buildPlaceholderText(options?.modificationCodes ?? []);

  return `https://placehold.co/${width}x${height}?text=${placeholderText}&font=inter&bg=${DEFAULT_BG_COLOR}&txtclr=${DEFAULT_TEXT_COLOR}`;
}

/* ------------------------------------------------------------------ */
/* Live generation (OpenAI gpt-image-1)                                */
/* ------------------------------------------------------------------ */

export const ACCESSIBILITY_RENDITION_S3_PREFIX = "accessibility-renditions" as const;
export const GPT_IMAGE_MODEL = "gpt-image-1" as const;

// Published gpt-image-1 per-token pricing, in USD per 1,000,000 tokens.
const GPT_IMAGE_PRICE_PER_MILLION_TOKENS_USD = {
  textInput: 5,
  imageInput: 10,
  imageOutput: 40,
};

export interface AccessibilityVisualGenerationResult {
  s3Url: string;
  s3Key: string;
  costUsd: number;
  model: string;
}

interface GptImageUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

export function buildAccessibilityVisualEditPrompt(modificationCodes: string[] = []): string {
  const modifications = modificationCodes.length
    ? modificationCodes.map((code) => MODIFICATION_LABELS[code] ?? code.replace(/_/g, " ")).join(", ")
    : "general accessibility improvements";

  return `Edit this photo of a home to show the following accessibility modification(s) installed, in a photorealistic style consistent with the room's existing materials and lighting: ${modifications}. Keep the rest of the room unchanged.`;
}

function computeGenerationCostUsd(usage: GptImageUsage | undefined): number {
  if (!usage) {
    return 0;
  }

  const textTokens = usage.input_tokens_details?.text_tokens ?? 0;
  const imageInputTokens = usage.input_tokens_details?.image_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;

  const cost =
    (textTokens / 1_000_000) * GPT_IMAGE_PRICE_PER_MILLION_TOKENS_USD.textInput +
    (imageInputTokens / 1_000_000) * GPT_IMAGE_PRICE_PER_MILLION_TOKENS_USD.imageInput +
    (outputTokens / 1_000_000) * GPT_IMAGE_PRICE_PER_MILLION_TOKENS_USD.imageOutput;

  return Math.round(cost * 10_000) / 10_000;
}

export function buildAccessibilityRenditionS3Key(
  projectId: string,
  photoId: string
): string {
  return `${ACCESSIBILITY_RENDITION_S3_PREFIX}/${projectId}/${photoId}-${randomUUID()}.png`;
}

/**
 * Calls the OpenAI gpt-image-1 edit endpoint with the client's original photo and
 * the identified modification codes, then stores the resulting image in S3.
 * Throws on any failure (network, API, or upload) — callers are responsible for
 * catching this, preserving the existing placeholder, and logging the failure.
 */
export async function generateAccessibilityVisual(
  photo: { id: string; projectId: string; url: string },
  modificationCodes: string[] = []
): Promise<AccessibilityVisualGenerationResult> {
  const signedSourceUrl = photo.url.includes(".amazonaws.com")
    ? await getSignedDownloadUrlFromS3Url(photo.url, 300)
    : photo.url;

  const sourceResponse = await fetch(signedSourceUrl);
  if (!sourceResponse.ok) {
    throw new Error(
      `Failed to download source photo ${photo.id} (${sourceResponse.status} ${sourceResponse.statusText})`
    );
  }

  const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
  const sourceFile = await toFile(sourceBuffer, `${photo.id}.png`, { type: "image/png" });

  const client = getOpenAIClient();
  const prompt = buildAccessibilityVisualEditPrompt(modificationCodes);

  const editResponse = await client.images.edit({
    model: GPT_IMAGE_MODEL,
    image: sourceFile,
    prompt,
    size: "1024x1024",
    quality: "medium",
  });

  const imageData = editResponse.data?.[0]?.b64_json;
  if (!imageData) {
    throw new Error(`OpenAI image edit returned no image data for photo ${photo.id}`);
  }

  const renderedBuffer = Buffer.from(imageData, "base64");
  const s3Key = buildAccessibilityRenditionS3Key(photo.projectId, photo.id);
  const s3Url = await uploadStreamToS3(renderedBuffer, s3Key, "image/png", renderedBuffer.length);

  return {
    s3Url,
    s3Key,
    costUsd: computeGenerationCostUsd(editResponse.usage as GptImageUsage | undefined),
    model: GPT_IMAGE_MODEL,
  };
}
