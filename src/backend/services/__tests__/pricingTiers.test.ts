import { MODIFICATION_CODES } from "@/backend/eligibility/types";
import {
  DEFAULT_PRICING_TIER,
  PRICING_TIER_CONFIG,
  PRICING_TIER_KEYS,
  getApplicableTiers,
  isTieredEstimate,
  projectSupportsTieredPricing,
} from "@/backend/services/pricingTiers";
import type { RefinedEstimate } from "@/backend/services/refinedEstimate";

const baseEstimate: RefinedEstimate = {
  lineItems: [],
  modificationTotals: [],
  subtotal: 100,
  laborTotal: 20,
  markupTotal: 15,
  total: 135,
  estimateMin: 128,
  estimateMax: 142,
};

describe("pricingTiers config", () => {
  it("defines exactly economy, standard, and premium tiers", () => {
    expect(PRICING_TIER_KEYS).toEqual(["economy", "standard", "premium"]);
    expect(Object.keys(PRICING_TIER_CONFIG).sort()).toEqual(
      ["economy", "premium", "standard"]
    );
  });

  it("defaults to the standard tier", () => {
    expect(DEFAULT_PRICING_TIER).toBe("standard");
  });

  it("applies no markup to any tier, since LandSeed does not take a margin on senior-facing quotes", () => {
    expect(PRICING_TIER_CONFIG.economy.markupPercentage).toBe(0);
    expect(PRICING_TIER_CONFIG.standard.markupPercentage).toBe(0);
    expect(PRICING_TIER_CONFIG.premium.markupPercentage).toBe(0);
  });
});

describe("projectSupportsTieredPricing / getApplicableTiers", () => {
  it("returns true/all tiers for every modification code, since all default to tiered", () => {
    const codes = [MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.HANDRAILS];
    expect(projectSupportsTieredPricing(codes)).toBe(true);
    expect(getApplicableTiers(codes)).toEqual(["economy", "standard", "premium"]);
  });

  it("returns true/all tiers when at least one selected modification supports tiers", () => {
    const codes = [MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.WALK_IN_SHOWER];
    expect(projectSupportsTieredPricing(codes)).toBe(true);
    expect(getApplicableTiers(codes)).toEqual(["economy", "standard", "premium"]);
  });

  it("returns false/empty for an empty modification list", () => {
    expect(projectSupportsTieredPricing([])).toBe(false);
    expect(getApplicableTiers([])).toEqual([]);
  });
});

describe("isTieredEstimate", () => {
  it("returns false for a single-tier estimate", () => {
    expect(isTieredEstimate(baseEstimate)).toBe(false);
  });

  it("returns true for a tiered estimate", () => {
    expect(
      isTieredEstimate({
        tiers: {
          economy: baseEstimate,
          standard: baseEstimate,
          premium: baseEstimate,
        },
        selectedTier: "standard",
      })
    ).toBe(true);
  });

  it("returns false for null/undefined", () => {
    expect(isTieredEstimate(null)).toBe(false);
    expect(isTieredEstimate(undefined)).toBe(false);
  });
});
