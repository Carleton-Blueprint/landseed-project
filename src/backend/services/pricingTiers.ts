import { MODIFICATION_CODES, ModificationCode } from "@/backend/eligibility/types";
import type { RefinedEstimate } from "@/backend/services/refinedEstimate";

export const PRICING_TIER_KEYS = ["economy", "standard", "premium"] as const;

export type PricingTierKey = (typeof PRICING_TIER_KEYS)[number];

export const DEFAULT_PRICING_TIER: PricingTierKey = "standard";

export interface PricingTierAdjustment {
  laborMultiplier: number;
  markupPercentage: number;
}

// markupPercentage defaults to 0 across all tiers: LandSeed is a nonprofit and
// does not take a margin on top of actual cost from seniors. The field stays
// on the config (rather than being removed) in case it's needed later for
// internal cost/overhead modeling.
//
// No materialMultiplier here: each tier now sources a genuinely different
// product directly from the same fetched SerpAPI candidate list (see
// refinedEstimate.ts's selectTierPrices) instead of marking up one fetched
// price, so a material-price multiplier would be redundant.
export const PRICING_TIER_CONFIG: Record<PricingTierKey, PricingTierAdjustment> = {
  economy: { laborMultiplier: 0.9, markupPercentage: 0 },
  standard: { laborMultiplier: 1, markupPercentage: 0 },
  premium: { laborMultiplier: 1.15, markupPercentage: 0 },
};

export const PRICING_TIER_LABELS: Record<PricingTierKey, string> = {
  economy: "Economy",
  standard: "Standard",
  premium: "Premium",
};

/**
 * Single source of truth for which modification codes are eligible for tiered
 * pricing. A quote is tiered if any of its selected modification codes are
 * marked `true` here, since the tiered breakdown is generated for the whole
 * quote rather than per line item.
 *
 * Defaults to all `true`: there's no system-side basis for deciding which
 * modification types deserve tiering and which don't, so that choice should
 * belong to the client rather than being arbitrarily decided here. The map
 * stays in place as the single place to override this later if needed.
 */
const SUPPORTS_TIERS_BY_MODIFICATION_CODE: Record<ModificationCode, boolean> = {
  [MODIFICATION_CODES.GRAB_BARS]: true,
  [MODIFICATION_CODES.RAISED_TOILET]: true,
  [MODIFICATION_CODES.WALK_IN_SHOWER]: true,
  [MODIFICATION_CODES.WIDENED_DOORWAY]: true,
  [MODIFICATION_CODES.STAIR_LIFT]: true,
  [MODIFICATION_CODES.HANDRAILS]: true,
};

export function projectSupportsTieredPricing(modificationCodes: ModificationCode[]): boolean {
  return modificationCodes.some((code) => SUPPORTS_TIERS_BY_MODIFICATION_CODE[code] === true);
}

export function getApplicableTiers(modificationCodes: ModificationCode[]): PricingTierKey[] {
  return projectSupportsTieredPricing(modificationCodes) ? [...PRICING_TIER_KEYS] : [];
}

export interface TieredRefinedEstimate {
  tiers: Record<PricingTierKey, RefinedEstimate>;
  selectedTier?: PricingTierKey;
}

export type AnyRefinedEstimate = RefinedEstimate | TieredRefinedEstimate;

export function isTieredEstimate(
  estimate: AnyRefinedEstimate | null | undefined
): estimate is TieredRefinedEstimate {
  return (
    !!estimate &&
    typeof estimate === "object" &&
    "tiers" in estimate &&
    typeof (estimate as TieredRefinedEstimate).tiers === "object" &&
    (estimate as TieredRefinedEstimate).tiers != null
  );
}
