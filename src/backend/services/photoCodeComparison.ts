/**
 * Compares a photo's client-declared modification codes with the codes photo analysis
 * inferred. Pure (no Prisma/OpenAI imports) so admin client components can use it too.
 */
import { MODIFICATION_CODES, ModificationCode } from "@/backend/eligibility/types";

// Codes that are the same thing as far as a photo can tell. Comparison-only: the
// taxonomy, pricing and grant mappings still treat them as separate codes. Don't add
// codes that are genuinely different products (e.g. WALK_IN_TUB vs WALK_IN_SHOWER).
const COMPARISON_SYNONYMS: Partial<Record<string, ModificationCode>> = {
  [MODIFICATION_CODES.WHEELCHAIR_RAMP]: MODIFICATION_CODES.RAMP,
};

function canonicalCode(code: string): string {
  return COMPARISON_SYNONYMS[code] ?? code;
}

export interface StoredCodeVerdict {
  code: string;
  verdict: string;
  confidence: string;
}

function isStoredCodeVerdict(value: unknown): value is StoredCodeVerdict {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "string" && typeof v.verdict === "string" && typeof v.confidence === "string";
}

/**
 * Declared codes that flag a photo for review. A declared code with a stored verdict
 * flags only on a HIGH-confidence "NO" — "CANT_TELL" and less confident "NO"s never
 * flag. A declared code without a verdict (photo analysed before verdicts existed, or a
 * code added after analysis) falls back to compareCodes: flagged if the AI didn't find it.
 */
export function flaggedDeclaredCodes(
  declared: string[],
  aiInferred: string[],
  storedVerdicts: unknown
): string[] {
  const verdicts = Array.isArray(storedVerdicts) ? storedVerdicts.filter(isStoredCodeVerdict) : [];
  const { missingCodes } = compareCodes(declared, aiInferred);
  return declared.filter((code) => {
    const verdict = verdicts.find((v) => v.code === code);
    if (verdict) return verdict.verdict === "NO" && verdict.confidence === "HIGH";
    return missingCodes.includes(code);
  });
}

/**
 * Declared codes the AI didn't find (after folding synonyms) — these flag the photo.
 * Codes the AI found beyond the declared ones are only suggestions and never flag.
 */
export function compareCodes(
  declared: string[],
  aiInferred: string[]
): { missingCodes: string[]; suggestedCodes: string[] } {
  const declaredCanonical = new Set(declared.map(canonicalCode));
  const aiCanonical = new Set(aiInferred.map(canonicalCode));
  return {
    missingCodes: declared.filter((code) => !aiCanonical.has(canonicalCode(code))),
    suggestedCodes: aiInferred.filter((code) => !declaredCanonical.has(canonicalCode(code))),
  };
}
