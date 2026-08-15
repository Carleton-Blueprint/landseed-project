import {
  MODIFICATION_CODES,
  ModificationCode,
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

export function normalizeLabel(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Normalizes user-selected intake modification labels into stable internal codes.
 * Frontend checkboxes ensure no unknowns or duplicates, so we just deduplicate and return.
 */
export function normalizeModificationItems(items: string[]): ModificationCode[] {
  const normalizedCodes: ModificationCode[] = [];
  const seenCodes = new Set<ModificationCode>();

  for (const rawItem of items) {
    const trimmed = rawItem.trim();
    if (!trimmed) {
      continue;
    }

    const lookupKey = normalizeLabel(trimmed);
    const code = INTAKE_MODIFICATION_LABEL_TO_CODE[lookupKey];

    if (code && !seenCodes.has(code)) {
      seenCodes.add(code);
      normalizedCodes.push(code);
    }
  }

  return normalizedCodes;
}

export const MODIFICATION_NORMALIZATION_MAP = INTAKE_MODIFICATION_LABEL_TO_CODE;
