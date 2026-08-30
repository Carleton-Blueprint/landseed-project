import {
  MODIFICATION_CODES,
  ModificationCode,
} from "@/backend/eligibility/types";
import { MODIFICATION_COST_CATALOG } from "@/backend/services/modificationCostCatalog";
import type { QuoteItem } from "@/backend/services/refinedEstimate";

// Placeholder used only when a project reaches quote generation with no tagged modification codes.
const NO_MODIFICATIONS_FALLBACK_PRICE = 150;

const INTAKE_MODIFICATION_LABEL_TO_CODE: Record<string, ModificationCode> = {
  "grab bars": MODIFICATION_CODES.GRAB_BARS,
  "raised toilet": MODIFICATION_CODES.RAISED_TOILET,
  "walk-in shower": MODIFICATION_CODES.WALK_IN_SHOWER,
  "walk in shower": MODIFICATION_CODES.WALK_IN_SHOWER,
  "widened doorway": MODIFICATION_CODES.WIDENED_DOORWAY,
  "stair lift": MODIFICATION_CODES.STAIR_LIFT,
  handrails: MODIFICATION_CODES.HANDRAILS,
  ramp: MODIFICATION_CODES.RAMP,
  "threshold ramp": MODIFICATION_CODES.RAMP,
  "wheelchair ramp": MODIFICATION_CODES.WHEELCHAIR_RAMP,
  "wheel chair ramp": MODIFICATION_CODES.WHEELCHAIR_RAMP,
  "walk-in tub": MODIFICATION_CODES.WALK_IN_TUB,
  "walk in tub": MODIFICATION_CODES.WALK_IN_TUB,
  "non-slip flooring": MODIFICATION_CODES.NON_SLIP_FLOORING,
  "non slip flooring": MODIFICATION_CODES.NON_SLIP_FLOORING,
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

export interface ModificationCodeSource {
  declaredModificationCodes: string[];
}

export interface PhotoModificationOverrideEntry {
  photoId: string;
  declaredModificationCodes: ModificationCode[];
}

export class InvalidPhotoModificationsError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Validates a client-supplied photoModifications payload (photoId +
 * declaredModificationCodes pairs) against the project's actual photos and
 * the modification-code taxonomy. Shared by the pre-estimate (FR-4.10) and
 * post-estimate (FR-4.3) override services so both reject malformed input
 * the same way instead of drifting.
 */
export function validatePhotoModifications(
  input: unknown,
  projectPhotoIds: Set<string>
): PhotoModificationOverrideEntry[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new InvalidPhotoModificationsError("photoModifications must be a non-empty array");
  }

  const seenPhotoIds = new Set<string>();
  const entries: PhotoModificationOverrideEntry[] = [];

  for (const raw of input) {
    const photoId =
      raw && typeof raw === "object" ? (raw as { photoId?: unknown }).photoId : undefined;
    const codesRaw =
      raw && typeof raw === "object"
        ? (raw as { declaredModificationCodes?: unknown }).declaredModificationCodes
        : undefined;

    if (typeof photoId !== "string" || !photoId.trim() || !Array.isArray(codesRaw)) {
      throw new InvalidPhotoModificationsError(
        "Each photoModifications entry must have a photoId and a declaredModificationCodes array"
      );
    }

    if (!projectPhotoIds.has(photoId)) {
      throw new InvalidPhotoModificationsError(`Photo ${photoId} does not belong to this project`);
    }

    if (seenPhotoIds.has(photoId)) {
      throw new InvalidPhotoModificationsError(`Duplicate photoId in photoModifications: ${photoId}`);
    }
    seenPhotoIds.add(photoId);

    if (!codesRaw.every((c): c is string => typeof c === "string")) {
      throw new InvalidPhotoModificationsError("declaredModificationCodes must contain only strings");
    }

    const { codes, invalidCodes } = parseDeclaredModificationCodes(codesRaw);
    if (invalidCodes.length > 0) {
      throw new InvalidPhotoModificationsError(
        `Unrecognized modification code(s): ${invalidCodes.join(", ")}`
      );
    }

    if (codes.length === 0) {
      throw new InvalidPhotoModificationsError(`Photo ${photoId} must have at least one modification tag`);
    }

    entries.push({ photoId, declaredModificationCodes: codes });
  }

  return entries;
}

/**
 * Unions and dedupes each photo's already-validated declaredModificationCodes
 * into a single, canonically-ordered list — the project-level "list of
 * modification items" consumed by cost estimation, eligibility, and grant
 * PDF generation, now that per-photo tagging is the source of truth instead
 * of a separate project-level field.
 */
export function aggregateDeclaredModificationCodes(
  photos: ModificationCodeSource[]
): ModificationCode[] {
  const seenCodes = new Set<ModificationCode>();

  for (const photo of photos) {
    for (const code of photo.declaredModificationCodes) {
      if (VALID_MODIFICATION_CODES.has(code)) {
        seenCodes.add(code as ModificationCode);
      }
    }
  }

  return Object.values(MODIFICATION_CODES).filter((code) => seenCodes.has(code));
}

/**
 * Builds catalog-priced quote line items from a project's modification codes.
 * Shared by the delayed estimate-generation worker and eligibility
 * evaluation's auto-quote fallback, so both produce real, priced quotes
 * from the same data rather than one of them using a placeholder.
 */
export function buildQuoteItems(modificationCodes: ModificationCode[]): QuoteItem[] {
  if (modificationCodes.length === 0) {
    return [
      {
        description: "Home modifications (initial intake estimate)",
        quantity: 1,
        unitPrice: NO_MODIFICATIONS_FALLBACK_PRICE,
      },
    ];
  }

  return modificationCodes.map((code) => {
    const catalogEntry = MODIFICATION_COST_CATALOG[code];

    return {
      description: catalogEntry.label,
      quantity: 1,
      unitPrice: catalogEntry.fallbackUnitPrice,
      modificationCode: code,
    };
  });
}
