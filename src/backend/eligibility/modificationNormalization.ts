import {
  MODIFICATION_CODES,
  ModificationCode,
  NormalizedModificationItemsResult,
} from "@/backend/eligibility/types";

const INTAKE_MODIFICATION_LABEL_TO_CODE: Record<string, ModificationCode> = {
  "grab bars": MODIFICATION_CODES.GRAB_BARS,
  "raised toilet": MODIFICATION_CODES.RAISED_TOILET,
  "walk-in shower": MODIFICATION_CODES.WALK_IN_SHOWER,
  "walk in shower": MODIFICATION_CODES.WALK_IN_SHOWER,
  "widened doorway": MODIFICATION_CODES.WIDENED_DOORWAY,
  "stair lift": MODIFICATION_CODES.STAIR_LIFT,
  handrails: MODIFICATION_CODES.HANDRAILS,
};

function normalizeLabel(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Normalizes user-selected intake modification labels into stable internal codes.
 * - Deduplicates by internal code
 * - Collects unknown labels for downstream reason-code handling
 * - Tracks duplicate known selections for deterministic auditing
 */
export function normalizeModificationItems(
  items: string[]
): NormalizedModificationItemsResult {
  const normalizedCodes: ModificationCode[] = [];
  const duplicateCodes: ModificationCode[] = [];
  const unknownItems: string[] = [];

  const seenCodes = new Set<ModificationCode>();
  const seenUnknownLabels = new Set<string>();

  for (const rawItem of items) {
    const trimmed = rawItem.trim();
    if (!trimmed) {
      continue;
    }

    const lookupKey = normalizeLabel(trimmed);
    const code = INTAKE_MODIFICATION_LABEL_TO_CODE[lookupKey];

    if (!code) {
      if (!seenUnknownLabels.has(lookupKey)) {
        seenUnknownLabels.add(lookupKey);
        unknownItems.push(trimmed);
      }
      continue;
    }

    if (seenCodes.has(code)) {
      if (!duplicateCodes.includes(code)) {
        duplicateCodes.push(code);
      }
      continue;
    }

    seenCodes.add(code);
    normalizedCodes.push(code);
  }

  return {
    normalizedCodes,
    unknownItems,
    duplicateCodes,
  };
}

export const MODIFICATION_NORMALIZATION_MAP = INTAKE_MODIFICATION_LABEL_TO_CODE;
