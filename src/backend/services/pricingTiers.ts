import { MODIFICATION_CODES, ModificationCode } from "@/backend/eligibility/types";
import type { RefinedEstimate } from "@/backend/services/refinedEstimate";

export const PRICING_TIER_KEYS = ["economy", "standard", "premium"] as const;

export type PricingTierKey = (typeof PRICING_TIER_KEYS)[number];

export const DEFAULT_PRICING_TIER: PricingTierKey = "standard";

export interface PricingTierAdjustment {
  materialMultiplier: number;
  laborMultiplier: number;
  markupPercentage: number;
}

export const PRICING_TIER_CONFIG: Record<PricingTierKey, PricingTierAdjustment> = {
  economy: { materialMultiplier: 0.85, laborMultiplier: 0.9, markupPercentage: 0.1 },
  standard: { materialMultiplier: 1, laborMultiplier: 1, markupPercentage: 0.15 },
  premium: { materialMultiplier: 1.25, laborMultiplier: 1.15, markupPercentage: 0.22 },
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
 */
const SUPPORTS_TIERS_BY_MODIFICATION_CODE: Record<ModificationCode, boolean> = {
  [MODIFICATION_CODES.GRAB_BARS]: false,
  [MODIFICATION_CODES.RAISED_TOILET]: false,
  [MODIFICATION_CODES.WALK_IN_SHOWER]: true,
  [MODIFICATION_CODES.WIDENED_DOORWAY]: true,
  [MODIFICATION_CODES.STAIR_LIFT]: true,
  [MODIFICATION_CODES.HANDRAILS]: false,
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
