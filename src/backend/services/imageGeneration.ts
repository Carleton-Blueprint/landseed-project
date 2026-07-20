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
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { normalizeModificationItems } from "@/backend/eligibility/modificationNormalization";

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

/* ------------------------------------------------------------------ */
/* Job processing (invoked from the ai-jobs queue worker)               */
/* ------------------------------------------------------------------ */

/**
 * Extracts a project's modification items from draftData and normalizes them
 * from the intake form's human-readable labels (e.g. "Grab bars") into the
 * canonical MODIFICATION_CODES used elsewhere in the system (e.g. "GRAB_BARS"),
 * so callers can rely on MODIFICATION_LABELS lookups matching.
 */
export function modificationItemsFromDraft(draftData: unknown): string[] {
  if (!draftData || typeof draftData !== "object" || Array.isArray(draftData)) {
    return [];
  }

  const raw = (draftData as Record<string, unknown>).modificationItems;
  if (!Array.isArray(raw)) return [];
  const labels = raw.filter((item): item is string => typeof item === "string");
  return normalizeModificationItems(labels);
}

export const ACCESSIBILITY_IMAGE_GENERATION_JOB_TYPE = "ACCESSIBILITY_IMAGE_GENERATION" as const;

export interface AccessibilityImageGenerationJobPayload {
  photoId: string;
}

/**
 * Processes one accessibility-visual generation job: marks the photo as
 * GENERATING, calls the live OpenAI edit endpoint, and records the outcome.
 * On failure, the photo's existing generatedImageUrl/S3Key are left untouched
 * so the dashboard keeps showing whatever it was already showing (placeholder
 * or a prior successful rendition) — only generationStatus/generationError change.
 */
export async function processAccessibilityImageGenerationJob(
  payload: AccessibilityImageGenerationJobPayload
): Promise<void> {
  const photo = await prisma.photo.findUnique({
    where: { id: payload.photoId },
    include: { project: true },
  });

  if (!photo) {
    throw new Error(`Photo not found: ${payload.photoId}`);
  }

  await prisma.photo.update({
    where: { id: photo.id },
    data: { generationStatus: "GENERATING" },
  });

  const modificationCodes = modificationItemsFromDraft(photo.project.draftData);
  const startedAt = Date.now();

  try {
    const result = await generateAccessibilityVisual(
      { id: photo.id, projectId: photo.projectId, url: photo.url },
      modificationCodes
    );

    await prisma.photo.update({
      where: { id: photo.id },
      data: {
        generationStatus: "READY",
        generatedImageUrl: result.s3Url,
        generatedImageS3Key: result.s3Key,
        generationCostUsd: result.costUsd,
        generationModel: result.model,
        generatedAt: new Date(),
        generationError: null,
      },
    });

    await logAuditEventNonBlocking({
      category: "AI_GENERATION",
      action: "ACCESSIBILITY_IMAGE_GENERATION_READY",
      outcome: "SUCCESS",
      sensitivityLevel: "INTERNAL",
      projectId: photo.projectId,
      resourceType: "photo",
      resourceId: photo.id,
      description: "Accessibility visual rendition generated successfully",
      metadata: {
        model: result.model,
        costUsd: result.costUsd,
        durationMs: Date.now() - startedAt,
        s3Key: result.s3Key,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown image generation error";

    await prisma.photo.update({
      where: { id: photo.id },
      data: {
        generationStatus: "FAILED",
        generationError: errorMessage,
      },
    });

    await logAuditEventNonBlocking({
      category: "AI_GENERATION",
      action: "ACCESSIBILITY_IMAGE_GENERATION_FAILED",
      outcome: "FAILURE",
      sensitivityLevel: "INTERNAL",
      projectId: photo.projectId,
      resourceType: "photo",
      resourceId: photo.id,
      description: "Accessibility visual rendition generation failed; retaining existing placeholder",
      metadata: {
        errorMessage,
        durationMs: Date.now() - startedAt,
      },
    });

    throw error;
  }
}
