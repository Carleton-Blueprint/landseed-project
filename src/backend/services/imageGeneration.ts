/**
 * Image generation for accessibility modification visualizations.
 *
 * generateAccessibilityVisual() is the live path: it sends the client's original
 * photo plus the identified modification types to OpenAI's gpt-image-1 edit
 * endpoint and stores the result in S3. generateMockAccessibilityVisual() is not
 * a flag-gated alternative — it's the placeholder used only once BullMQ retries
 * on the live call are exhausted (see applyAccessibilityVisualMockFallback() and
 * its caller in aiJobsWorker.ts).
 */
import { randomUUID } from "node:crypto";
import { toFile } from "openai";
import { getOpenAIClient } from "lib/openai";
import { getSignedDownloadUrlFromS3Url, uploadStreamToS3 } from "lib/s3";
import { isPrivateS3PhotoUrl } from "lib/photoUrls";
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { MODIFICATION_COST_CATALOG } from "@/backend/services/modificationCostCatalog";
import { getModificationPlacementRule } from "@/backend/services/imageModificationPlacement";
import type { ModificationCode } from "@/backend/eligibility/types";
import type { AiProvenanceMetadata } from "@/backend/audit/aiProvenance";

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 600;
const DEFAULT_BG_COLOR = "efefef";
const DEFAULT_TEXT_COLOR = "333";

function getModificationLabel(code: string): string {
  return MODIFICATION_COST_CATALOG[code as ModificationCode]?.label ?? code.replace(/_/g, " ");
}

function formatModificationLabel(codes: string[]): string {
  if (codes.length === 0) {
    return "Accessibility+Visual";
  }

  const labels = codes.map(getModificationLabel).slice(0, 3);

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
  promptVersion: number;
}

interface GptImageUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

// Bump whenever buildAccessibilityVisualEditPrompt's wording changes, so the
// audit trail records which prompt produced each rendition. v1 was the
// original label-only prompt.
export const ACCESSIBILITY_VISUAL_PROMPT_VERSION = 2 as const;

function formatPlacementSection(code: string, index: number): string {
  const label = getModificationLabel(code);
  const rule = getModificationPlacementRule(code);

  if (!rule) {
    return `${index + 1}. ${label}\n   - Install it only where it would realistically be installed in this room.`;
  }

  return [
    `${index + 1}. ${label}`,
    `   - Quantity: ${rule.quantity}`,
    `   - Placement: ${rule.placement}`,
    `   - Mounting: ${rule.mounting}`,
    `   - Size: ${rule.scale}`,
    ...rule.never.map((line) => `   - ${line}`),
  ].join("\n");
}

export function buildAccessibilityVisualEditPrompt(modificationCodes: string[] = []): string {
  const codes = [...new Set(modificationCodes)];
  const items = codes.length
    ? codes.map(formatPlacementSection).join("\n\n")
    : "1. general accessibility improvements\n   - Install them only where they would realistically be installed in this room.";

  return [
    "Edit this photo of a home to show the accessibility modification(s) below installed, in a photorealistic style that matches the room's existing materials, lighting and camera angle.",
    "",
    "Add ONLY these items:",
    "",
    items,
    "",
    "Strict rules:",
    "- Add ONLY the items listed above. Do not add any other fixtures, furniture, decor or accessibility equipment.",
    "- Keep every other surface, wall, floor, fixture and object exactly as it appears in the original photo.",
    "- Keep the same framing, perspective and room layout.",
    "- If an item has no realistic location visible in this photo, leave that part of the photo unchanged rather than inventing a location.",
  ].join("\n");
}

type SupportedSourceImageType = "image/png" | "image/jpeg" | "image/webp";

/**
 * Sniffs the image type from magic bytes. Uploads are restricted to
 * JPEG/PNG/WebP (see /api/upload), but the stored object's Content-Type
 * isn't reliable, so read the bytes instead. Falls back to PNG.
 */
export function detectSourceImageType(buffer: Buffer): {
  mimeType: SupportedSourceImageType;
  extension: string;
} {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return { mimeType: "image/png", extension: "png" };
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
  const signedSourceUrl = isPrivateS3PhotoUrl(photo.url)
    ? await getSignedDownloadUrlFromS3Url(photo.url, 300)
    : photo.url;

  const sourceResponse = await fetch(signedSourceUrl);
  if (!sourceResponse.ok) {
    throw new Error(
      `Failed to download source photo ${photo.id} (${sourceResponse.status} ${sourceResponse.statusText})`
    );
  }

  const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
  const sourceType = detectSourceImageType(sourceBuffer);
  const sourceFile = await toFile(sourceBuffer, `${photo.id}.${sourceType.extension}`, {
    type: sourceType.mimeType,
  });

  const client = getOpenAIClient();
  const prompt = buildAccessibilityVisualEditPrompt(modificationCodes);

  const editResponse = await client.images.edit({
    model: GPT_IMAGE_MODEL,
    image: sourceFile,
    prompt,
    // "auto" lets the model pick the output aspect ratio closest to the
    // source photo instead of cropping/squashing everything into a square.
    size: "auto",
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
    promptVersion: ACCESSIBILITY_VISUAL_PROMPT_VERSION,
  };
}

/* ------------------------------------------------------------------ */
/* Job processing (invoked from the ai-jobs queue worker)               */
/* ------------------------------------------------------------------ */

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

  if (photo.project.isManualMode) {
    return;
  }

  await prisma.photo.update({
    where: { id: photo.id },
    data: { generationStatus: "GENERATING" },
  });

  // Client-declared per-photo tags (see IntakeForm.tsx's tag picker) drive
  // generation. Every photo is guaranteed a
  // non-empty declaredModificationCodes by intake submit time (see
  // promoteIntakeDraft's PHOTOS_MISSING_TAGS check), so no fallback is needed.
  const modificationCodes = photo.declaredModificationCodes;
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
        promptVersion: result.promptVersion,
        costUsd: result.costUsd,
        durationMs: Date.now() - startedAt,
        s3Key: result.s3Key,
        outputSource: "LIVE",
        isFallback: false,
      } satisfies AiProvenanceMetadata & Record<string, unknown>,
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
        promptVersion: ACCESSIBILITY_VISUAL_PROMPT_VERSION,
        durationMs: Date.now() - startedAt,
        outputSource: "NONE",
        isFallback: false,
      } satisfies AiProvenanceMetadata & Record<string, unknown>,
    });

    throw error;
  }
}

/**
 * Called once the ai-jobs worker has exhausted all retry attempts for a live
 * generation job (see aiJobsWorker.ts's "failed" handler) — a single failed
 * attempt is not "live unavailable," but exhausting retries is. Applies the
 * mock placeholder so the photo has something to display, while leaving
 * generationStatus/generationError as the worker already set them so staff
 * can still see that the live attempt failed.
 */
export async function applyAccessibilityVisualMockFallback(
  photoId: string,
  errorMessage: string
): Promise<void> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
  });

  if (!photo) {
    return;
  }

  const fallbackImageUrl = await generateMockAccessibilityVisual(photo.url, {
    modificationCodes: photo.declaredModificationCodes,
  });

  await prisma.photo.update({
    where: { id: photo.id },
    data: {
      generatedImageUrl: fallbackImageUrl,
      generatedImageS3Key: null,
      generationModel: "mock-fallback",
      generatedAt: new Date(),
    },
  });

  await logAuditEventNonBlocking({
    category: "AI_GENERATION",
    action: "ACCESSIBILITY_IMAGE_GENERATION_FALLBACK",
    outcome: "FAILURE",
    sensitivityLevel: "INTERNAL",
    projectId: photo.projectId,
    resourceType: "photo",
    resourceId: photo.id,
    reason: errorMessage,
    description: "Live accessibility visual generation failed after all retry attempts; served mock placeholder as fallback.",
    metadata: {
      model: "mock-fallback",
      fallbackImageUrl,
      errorMessage,
      outputSource: "MOCK",
      isFallback: true,
    } satisfies AiProvenanceMetadata & Record<string, unknown>,
  });
}
