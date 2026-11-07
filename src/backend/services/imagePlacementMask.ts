/**
 * Turns the placement planner's boxes into an images.edit mask.
 *
 * OpenAI edits the fully transparent areas of the mask and leaves opaque areas
 * alone (strong guidance, not a hard guarantee). The mask must be a PNG with
 * the same pixel dimensions as the source photo, so the photo is
 * EXIF-oriented first — otherwise a portrait phone photo stored sideways
 * would get a mask rotated 90° from what the planner saw.
 */
import sharp from "sharp";
import type { PlacementBox, PlacementPlan } from "@/backend/services/imagePlacementPlanner";

/**
 * IMAGE_EDIT_MASK_ENABLED (worker). Off by default: in the 2026-11-07 sample
 * run the gpt-image-2.6 models didn't keep masked edits inside the boxes and
 * often changed more of the scene than without a mask, so the mask stays
 * available but opt-in.
 */
export function isImageEditMaskEnabled(): boolean {
  return (process.env.IMAGE_EDIT_MASK_ENABLED ?? "false").trim().toLowerCase() === "true";
}

// Planner boxes are approximate; pad each side by this fraction of the image
// so the item (and its shadow/mounting hardware) fits inside the edit area.
export const PLACEMENT_MASK_PADDING = 0.04;

/**
 * Applies the EXIF orientation so pixel data matches how the photo is viewed.
 * Returns the original buffer untouched when no rotation is needed or the
 * bytes can't be read as an image.
 */
export async function normalizeImageOrientation(buffer: Buffer): Promise<Buffer> {
  try {
    const { orientation } = await sharp(buffer).metadata();
    if (!orientation || orientation === 1) {
      return buffer;
    }
    return await sharp(buffer).rotate().toBuffer();
  } catch {
    return buffer;
  }
}

export function padPlacementBox(box: PlacementBox, padding = PLACEMENT_MASK_PADDING): PlacementBox {
  const left = Math.max(0, box.x - padding);
  const top = Math.max(0, box.y - padding);
  const right = Math.min(1, box.x + box.width + padding);
  const bottom = Math.min(1, box.y + box.height + padding);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Builds an opaque PNG of the given size with a transparent hole for each
 * box (normalized 0–1 coordinates).
 */
export async function buildPlacementMask(
  width: number,
  height: number,
  boxes: PlacementBox[]
): Promise<Buffer> {
  const holes = boxes
    .map((box) => {
      const left = Math.floor(box.x * width);
      const top = Math.floor(box.y * height);
      const right = Math.min(width, Math.ceil((box.x + box.width) * width));
      const bottom = Math.min(height, Math.ceil((box.y + box.height) * height));
      return { left, top, width: right - left, height: bottom - top };
    })
    .filter((hole) => hole.width > 0 && hole.height > 0);

  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite(
      holes.map((hole) => ({
        input: {
          create: {
            width: hole.width,
            height: hole.height,
            channels: 4 as const,
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          },
        },
        left: hole.left,
        top: hole.top,
        blend: "dest-out" as const,
      }))
    )
    .png()
    .toBuffer();
}

export async function getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height } = await sharp(buffer).metadata();
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

export type PlacementMaskResult =
  | { applied: true; mask: Buffer; boxes: PlacementBox[] }
  | {
      applied: false;
      reason: "DISABLED" | "NO_PLAN" | "NO_APPLICABLE_PLACEMENTS" | "MISSING_BOX" | "UNREADABLE_IMAGE";
    };

/**
 * Masks only when every applicable placement has a box: an applicable item
 * without one would otherwise fall entirely in the protected (opaque) area
 * and could never be drawn.
 */
export async function buildPlacementMaskForPlan(
  source: Buffer,
  plan: PlacementPlan | null
): Promise<PlacementMaskResult> {
  if (!plan) {
    return { applied: false, reason: "NO_PLAN" };
  }

  const applicable = plan.placements.filter((entry) => entry.applicable);
  if (applicable.length === 0) {
    return { applied: false, reason: "NO_APPLICABLE_PLACEMENTS" };
  }
  if (applicable.some((entry) => !entry.box)) {
    return { applied: false, reason: "MISSING_BOX" };
  }

  const dimensions = await getImageDimensions(source);
  if (!dimensions) {
    return { applied: false, reason: "UNREADABLE_IMAGE" };
  }

  const boxes = applicable.map((entry) => padPlacementBox(entry.box!));
  const mask = await buildPlacementMask(dimensions.width, dimensions.height, boxes);
  return { applied: true, mask, boxes };
}

/** Audit-trail shape: which areas were opened for editing, or why no mask was sent. */
export function buildPlacementMaskAuditMetadata(result: PlacementMaskResult): Record<string, unknown> {
  return result.applied ? { applied: true, boxes: result.boxes } : { applied: false, reason: result.reason };
}
