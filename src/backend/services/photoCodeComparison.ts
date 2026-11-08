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
