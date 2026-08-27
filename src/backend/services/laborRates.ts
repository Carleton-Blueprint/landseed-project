// Flat hourly labor rate applied to every line item, regardless of pricing tier
// (economy/standard/premium tiers differ only by material selection — see
// pricingTiers.ts and refinedEstimate.ts's selectTierPrices).
export const LABOR_RATE_PER_HOUR = 150;

// Flat dispatch fee charged for any service visit. Added on top of the
// computed material + labor total on every quote/tier, regardless of job
// size — not a minimum, so it doesn't get absorbed into a larger labor total.
export const CALL_OUT_FEE = 150;
