/**
 * Mock image generation wrapper for accessibility modification visualizations.
 *
 * This service intentionally does not call OpenAI or any live image-generation API.
 * It returns transient placeholder visuals that simulate an image-to-image output.
 */

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
