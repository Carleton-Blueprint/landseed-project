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

const VALID_MODIFICATION_CODES = new Set<string>(Object.values(MODIFICATION_CODES));

export interface ParsedModificationCodes {
  codes: ModificationCode[];
  invalidCodes: string[];
}

/**
 * Validates and dedupes a client-supplied list of modification codes (e.g.
 * a photo's declared tags) against the MODIFICATION_CODES taxonomy. Unlike
 * normalizeModificationItems (which silently drops unrecognized labels for
 * the trusted, checkbox-constrained project-level list), this is an API
 * boundary validator: unrecognized values are reported back as invalidCodes
 * rather than dropped, so callers can reject the request with a 400.
 */
export function parseDeclaredModificationCodes(input: string[]): ParsedModificationCodes {
  const codes: ModificationCode[] = [];
  const invalidCodes: string[] = [];
  const seenCodes = new Set<string>();

  for (const rawItem of input) {
    const trimmed = rawItem.trim();
    if (!trimmed) {
      continue;
    }

    if (!VALID_MODIFICATION_CODES.has(trimmed)) {
      invalidCodes.push(rawItem);
      continue;
    }

    if (!seenCodes.has(trimmed)) {
      seenCodes.add(trimmed);
      codes.push(trimmed as ModificationCode);
    }
  }

  return { codes, invalidCodes };
}
