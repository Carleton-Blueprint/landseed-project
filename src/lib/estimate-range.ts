import {
  DEFAULT_PRICING_TIER,
  isTieredEstimate,
  type AnyRefinedEstimate,
} from "@/backend/services/pricingTiers";

export type QuoteEstimateLike =
  | {
      estimateMin?: { toString(): string } | number | string | null;
      estimateMax?: { toString(): string } | number | string | null;
      refinedEstimate?: unknown;
    }
  | null
  | undefined;

export function getEstimateRangeFromQuote(quote: QuoteEstimateLike) {
  if (!quote) {
    return null;
  }

  if (quote.estimateMin != null && quote.estimateMax != null) {
    const min = Number(quote.estimateMin.toString());
    const max = Number(quote.estimateMax.toString());

    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max };
    }
  }

  return getFallbackRangeFromRefinedEstimate(quote.refinedEstimate);
}

/**
 * Older/edge-case rows may not have the top-level estimateMin/estimateMax
 * columns populated. Falls back to the JSON estimate, reading the default
 * tier when the estimate is tiered.
 */
function getFallbackRangeFromRefinedEstimate(
  refinedEstimate: unknown
): { min: number; max: number } | null {
  if (!refinedEstimate || typeof refinedEstimate !== "object") {
    return null;
  }

  const estimate = refinedEstimate as AnyRefinedEstimate;
  const singleEstimate = isTieredEstimate(estimate)
    ? estimate.tiers[estimate.selectedTier ?? DEFAULT_PRICING_TIER]
    : estimate;

  if (
    !singleEstimate ||
    typeof singleEstimate.estimateMin !== "number" ||
    typeof singleEstimate.estimateMax !== "number"
  ) {
    return null;
  }

  return { min: singleEstimate.estimateMin, max: singleEstimate.estimateMax };
}

export function getEstimateSummary(project: {
  status: string;
  quotes?: Array<QuoteEstimateLike & { override?: { total: { toString(): string } | number | string } | null }>;
}) {
  const latestQuote = project.quotes?.[0] ?? null;
  const isFinalized = project.status !== "draft";

  if (!isFinalized) {
    return {
      value: "Available after project finalization",
      explanation:
        "Your initial estimate range will appear here after your project request is finalized. Pricing is dynamically generated from real-time external retail data.",
    };
  }

  if (latestQuote?.override) {
    const total = parseFloat(latestQuote.override.total.toString());
    return {
      value: `$${total.toLocaleString()}`,
      explanation: "This estimate was updated by our advisory team after your initial estimate was generated.",
    };
  }

  const estimateRange = getEstimateRangeFromQuote(latestQuote);
  if (estimateRange) {
    return {
      value: `$${estimateRange.min.toLocaleString()} – $${estimateRange.max.toLocaleString()}`,
      explanation:
        "This pricing is dynamically generated from real-time external retail data and may change as retailer pricing and product availability update.",
    };
  }

  return {
    value: "Generating estimate…",
    explanation:
      "We are generating your estimate using real-time external retail data.",
  };
}