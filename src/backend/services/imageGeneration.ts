/**
 * Image generation for accessibility modification visualizations.
 *
 * generateAccessibilityVisual() is the live path: it plans where each
 * modification goes in the client's original photo (imagePlacementPlanner.ts),
 * sends the photo, that plan and a mask built from it (imagePlacementMask.ts)
 * to OpenAI's image edit endpoint, and stores the result in S3. generateMockAccessibilityVisual() is not
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
import {
  planModificationPlacement,
  type ModificationPlacementPlanEntry,
  type PlacementBox,
  type PlacementPlan,
  type PlacementPlanResult,
} from "@/backend/services/imagePlacementPlanner";
import {
  buildPlacementMaskForPlan,
  isImageEditMaskEnabled,
  buildPlacementMaskAuditMetadata,
  normalizeImageOrientation,
  type PlacementMaskResult,
} from "@/backend/services/imagePlacementMask";
import {
  computeImageGenerationCostUsd,
  getImageGenerationModel,
  getImageGenerationQuality,
  getImageOutputCompression,
  IMAGE_OUTPUT_CONTENT_TYPE,
  IMAGE_OUTPUT_FORMAT,
  roundCostUsd,
  type ImageEditUsage,
  type ImageGenerationQuality,
} from "@/backend/services/imageGenerationModelConfig";
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
/* Live generation (OpenAI image edit)                                 */
/* ------------------------------------------------------------------ */

export const ACCESSIBILITY_RENDITION_S3_PREFIX = "accessibility-renditions" as const;

export interface AccessibilityVisualGenerationResult {
  s3Url: string;
  s3Key: string;
  /**
   * Planning + editing. Null when either model has no known price (see
   * imageGenerationModelConfig.ts / imagePlacementModelConfig.ts), so an
   * unpriced model reads as "unknown" rather than an undercount.
   */
  costUsd: number | null;
  costBreakdownUsd: { planning: number | null; editing: number | null };
  model: string;
  quality: ImageGenerationQuality;
  outputFormat: typeof IMAGE_OUTPUT_FORMAT;
  outputCompression: number;
  promptVersion: number;
  placementPlan: PlacementPlanResult;
  placementMask: PlacementMaskResult;
}

// Bump whenever buildAccessibilityVisualEditPrompt's wording changes, so the
// audit trail records which prompt produced each rendition. v1 was the
// original label-only prompt; v2 added static placement rules; v3 adds the
// per-photo placement plan.
export const ACCESSIBILITY_VISUAL_PROMPT_VERSION = 3 as const;

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function formatBox(box: PlacementBox): string {
  return `${formatPercent(box.x)}–${formatPercent(box.x + box.width)} across from the left edge, ${formatPercent(box.y)}–${formatPercent(box.y + box.height)} down from the top edge`;
}

function formatPlacementSection(
  code: string,
  index: number,
  planEntry: ModificationPlacementPlanEntry | undefined
): string {
  const label = getModificationLabel(code);
  const rule = getModificationPlacementRule(code);

  const photoSpecific = [
    ...(planEntry?.placement ? [`   - In this photo: ${planEntry.placement}`] : []),
    ...(planEntry?.box ? [`   - Approximate area: ${formatBox(planEntry.box)}.`] : []),
  ];

  if (!rule) {
    return [
      `${index + 1}. ${label}`,
      ...photoSpecific,
      "   - Install it only where it would realistically be installed in this room.",
    ].join("\n");
  }

  return [
    `${index + 1}. ${label}`,
    ...photoSpecific,
    `   - Quantity: ${rule.quantity}`,
    `   - Placement: ${rule.placement}`,
    `   - Mounting: ${rule.mounting}`,
    `   - Size: ${rule.scale}`,
    ...rule.never.map((line) => `   - ${line}`),
  ].join("\n");
}

/**
 * A plan is only worth applying if it leaves at least one item to add. When
 * the planner marks every requested modification not applicable, it's more
 * likely wrong than the client's own tags, so fall back to the static rules.
 */
export function isPlacementPlanApplicable(plan: PlacementPlan | null | undefined): plan is PlacementPlan {
  return Boolean(plan?.placements.some((entry) => entry.applicable));
}

export function buildAccessibilityVisualEditPrompt(
  modificationCodes: string[] = [],
  placementPlan?: PlacementPlan | null
): string {
  const plan = isPlacementPlanApplicable(placementPlan) ? placementPlan : null;
  const planEntries = new Map(plan?.placements.map((entry) => [entry.modificationCode, entry]));
  const allCodes = [...new Set(modificationCodes)];
  const skipped = allCodes.filter((code) => planEntries.get(code)?.applicable === false);
  const codes = allCodes.filter((code) => !skipped.includes(code));

  const items = codes.length
    ? codes.map((code, index) => formatPlacementSection(code, index, planEntries.get(code))).join("\n\n")
    : "1. general accessibility improvements\n   - Install them only where they would realistically be installed in this room.";

  const visible = plan?.visibleElements.length
    ? ["", `Visible in this photo: ${plan.visibleElements.join(", ")}.`]
    : [];

  const doNotAdd = skipped.length
    ? [
        "",
        "Do NOT add these (no realistic location in this photo):",
        ...skipped.map((code) => {
          const reason = planEntries.get(code)?.reason;
          return `- ${getModificationLabel(code)}${reason ? ` — ${reason}` : ""}`;
        }),
      ]
    : [];

  return [
    "Edit this photo of a home to show the accessibility modification(s) below installed, in a photorealistic style that matches the room's existing materials, lighting and camera angle.",
    ...visible,
    "",
    "Add ONLY these items:",
    "",
    items,
    ...doNotAdd,
    "",
    "Strict rules:",
    "- Add ONLY the items listed above. Do not add any other fixtures, furniture, decor or accessibility equipment.",
    "- Keep every other surface, wall, floor, fixture and object exactly as it appears in the original photo.",
    "- Keep the same framing, perspective and room layout.",
    "- If an item has no realistic location visible in this photo, leave that part of the photo unchanged rather than inventing a location.",
  ].join("\n");
}

/**
 * Audit-trail shape for the placement plan: the full AI output (raw response
 * and normalized plan) plus whether it actually shaped the edit prompt.
 */
export function buildPlacementPlanAuditMetadata(
  result: PlacementPlanResult | null
): Record<string, unknown> | null {
  if (!result) {
    return null;
  }

  return result.status === "READY"
    ? {
        status: result.status,
        applied: isPlacementPlanApplicable(result.plan),
        model: result.model,
        promptVersion: result.promptVersion,
        plan: result.plan,
        rawResponse: result.rawResponse,
        usage: result.usage,
        costUsd: result.costUsd,
      }
    : {
        status: result.status,
        applied: false,
        model: result.model,
        promptVersion: result.promptVersion,
        error: result.error,
        rawResponse: result.rawResponse,
        usage: result.usage,
        costUsd: result.costUsd,
      };
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

function buildCostSummary(
  planning: number | null,
  editing: number | null
): Pick<AccessibilityVisualGenerationResult, "costUsd" | "costBreakdownUsd"> {
  return {
    costUsd: planning === null || editing === null ? null : roundCostUsd(planning + editing),
    costBreakdownUsd: { planning, editing },
  };
}

export function buildAccessibilityRenditionS3Key(
  projectId: string,
  photoId: string
): string {
  return `${ACCESSIBILITY_RENDITION_S3_PREFIX}/${projectId}/${photoId}-${randomUUID()}.${IMAGE_OUTPUT_FORMAT}`;
}

/**
 * Calls the OpenAI image edit endpoint (model from IMAGE_GENERATION_MODEL) with the client's original photo and
 * the identified modification codes, then stores the resulting image in S3.
 * Throws on any failure (network, API, or upload) — callers are responsible for
 * catching this, preserving the existing placeholder, and logging the failure.
 */
export async function generateAccessibilityVisual(
  photo: { id: string; projectId: string; url: string },
  modificationCodes: string[] = [],
  options?: {
    // Called as soon as the plan exists, so the caller can still audit it if
    // the edit itself fails afterwards.
    onPlacementPlan?: (result: PlacementPlanResult) => void;
  }
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

  // Oriented up front so the planner's boxes, the mask and the edited image
  // all share the same pixel coordinates.
  const sourceBuffer = await normalizeImageOrientation(Buffer.from(await sourceResponse.arrayBuffer()));
  const sourceType = detectSourceImageType(sourceBuffer);
  const sourceFile = await toFile(sourceBuffer, `${photo.id}.${sourceType.extension}`, {
    type: sourceType.mimeType,
  });

  const placementPlan = await planModificationPlacement(
    { buffer: sourceBuffer, mimeType: sourceType.mimeType },
    modificationCodes
  );
  options?.onPlacementPlan?.(placementPlan);

  const plan = placementPlan.status === "READY" ? placementPlan.plan : null;
  const placementMask: PlacementMaskResult = isImageEditMaskEnabled()
    ? await buildPlacementMaskForPlan(sourceBuffer, isPlacementPlanApplicable(plan) ? plan : null)
    : { applied: false, reason: "DISABLED" };

  const client = getOpenAIClient();
  const model = getImageGenerationModel();
  const quality = getImageGenerationQuality();
  const outputCompression = getImageOutputCompression();
  const prompt = buildAccessibilityVisualEditPrompt(modificationCodes, plan);

  const editResponse = await client.images.edit({
    model,
    image: sourceFile,
    ...(placementMask.applied
      ? { mask: await toFile(placementMask.mask, `${photo.id}-mask.png`, { type: "image/png" }) }
      : {}),
    prompt,
    // "auto" lets the model pick the output aspect ratio closest to the
    // source photo instead of cropping/squashing everything into a square.
    size: "auto",
    quality,
    output_format: IMAGE_OUTPUT_FORMAT,
    output_compression: outputCompression,
  });

  const imageData = editResponse.data?.[0]?.b64_json;
  if (!imageData) {
    throw new Error(`OpenAI image edit returned no image data for photo ${photo.id}`);
  }

  const renderedBuffer = Buffer.from(imageData, "base64");
  const s3Key = buildAccessibilityRenditionS3Key(photo.projectId, photo.id);
  const s3Url = await uploadStreamToS3(renderedBuffer, s3Key, IMAGE_OUTPUT_CONTENT_TYPE, renderedBuffer.length);

  return {
    s3Url,
    s3Key,
    ...buildCostSummary(
      placementPlan.costUsd,
      computeImageGenerationCostUsd(model, editResponse.usage as ImageEditUsage | undefined)
    ),
    model,
    quality,
    outputFormat: IMAGE_OUTPUT_FORMAT,
    outputCompression,
    promptVersion: ACCESSIBILITY_VISUAL_PROMPT_VERSION,
    placementPlan,
    placementMask,
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
  let placementPlan: PlacementPlanResult | null = null;

  try {
    const result = await generateAccessibilityVisual(
      { id: photo.id, projectId: photo.projectId, url: photo.url },
      modificationCodes,
      { onPlacementPlan: (plan) => (placementPlan = plan) }
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
        quality: result.quality,
        outputFormat: result.outputFormat,
        outputCompression: result.outputCompression,
        promptVersion: result.promptVersion,
        placementPlan: buildPlacementPlanAuditMetadata(result.placementPlan),
        placementMask: buildPlacementMaskAuditMetadata(result.placementMask),
        costUsd: result.costUsd,
        costBreakdownUsd: result.costBreakdownUsd,
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
        model: getImageGenerationModel(),
        quality: getImageGenerationQuality(),
        outputFormat: IMAGE_OUTPUT_FORMAT,
        outputCompression: getImageOutputCompression(),
        promptVersion: ACCESSIBILITY_VISUAL_PROMPT_VERSION,
        placementPlan: buildPlacementPlanAuditMetadata(placementPlan),
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
