import { DEFAULT_PRICING_TIER } from "@/backend/services/pricingTiers";

export type PricingSource = "serp_api" | "serp_api_partial";

type LineItemLike = { pricingSource?: string | null };
type EstimateLike = { lineItems?: LineItemLike[]; tiers?: Record<string, { lineItems?: LineItemLike[] }> };

export function getPricingSourceFromRefinedEstimate(refinedEstimate: unknown): PricingSource {
  if (!refinedEstimate || typeof refinedEstimate !== "object" || Array.isArray(refinedEstimate)) {
    return "serp_api_partial";
  }

  const estimate = refinedEstimate as EstimateLike;
  const primaryEstimate = estimate.tiers ? estimate.tiers[DEFAULT_PRICING_TIER] : estimate;

  const lineItems = primaryEstimate?.lineItems ?? [];
  if (lineItems.length === 0) {
    return "serp_api_partial";
  }

  const allSerpSourced = lineItems.every(
    (item) => item.pricingSource !== null && item.pricingSource !== undefined && item.pricingSource !== "fallback"
  );
  return allSerpSourced ? "serp_api" : "serp_api_partial";
}
