import {
  getMaterialPriceCandidates,
  pickBestCandidate,
  type PriceCandidate,
  type PriceCandidatesResult,
} from "@/backend/services/pricing";
import { MODIFICATION_CODES, type ModificationCode } from "@/backend/eligibility/types";
import {
  MODIFICATION_COST_CATALOG,
  UNSPECIFIED_MODIFICATION_LABEL,
} from "@/backend/services/modificationCostCatalog";
import {
  DEFAULT_PRICING_TIER,
  getApplicableTiers,
  PRICING_TIER_CONFIG,
  type AnyRefinedEstimate,
  type PricingTierAdjustment,
  type PricingTierKey,
  type TieredRefinedEstimate,
} from "@/backend/services/pricingTiers";
import { LABOR_RATE_PER_HOUR, CALL_OUT_FEE } from "@/backend/services/laborRates";

const REFINED_ESTIMATE_DEBUG = (process.env.PRICING_DEBUG ?? "true").toLowerCase() !== "false";

// Mirrors the eligibility HEURISTIC-fallback pattern (src/backend/eligibility/service.ts,
// Step 3.5): distinguishes *why* a line item fell back to catalog pricing, so the audit
// trail (see quote.ts's fallbackLineItems) doesn't lump "SerpAPI had nothing" together
// with "SerpAPI had results, but not enough real spread to trust them for tiering."
export type PricingFallbackReason = "no_usable_price" | "implausible_tier_spread";

function logFallbackPricingUsed(details: {
  description: string;
  modificationCode?: ModificationCode;
  query: string;
  serpStatus: string;
  reason: PricingFallbackReason;
  fallbackUnitPrice: number;
}): void {
  if (!REFINED_ESTIMATE_DEBUG) return;
  const ts = new Date().toISOString();
  console.warn(
    `[PRICING:FALLBACK] ${ts} — Using fallback price for "${details.description}" ` +
      `(modificationCode=${details.modificationCode ?? "UNSPECIFIED"}, query="${details.query}", ` +
      `serpStatus=${details.serpStatus}, reason=${details.reason}) — fallbackUnitPrice=$${details.fallbackUnitPrice}`
  );
}

export interface RefinedEstimateLineItem {
  description: string;
  quantity: number;
  pricingQuery: string;
  pricingSource?: string | null;
  pricingLink?: string | null;
  modificationCode?: ModificationCode | null;
  modificationLabel?: string | null;
  materialUnitCost: number;
  materialTotal: number;
  laborHours: number;
  laborRate: number;
  laborTotal: number;
  markupPercentage: number;
  markupTotal: number;
  lineTotal: number;
  fallbackReason?: PricingFallbackReason | null;
  // True only for the synthetic "Service Call-Out Fee" line item buildEstimateForTier
  // appends when a tier's total labor falls short of MINIMUM_CALL_OUT_FEE (see
  // laborRates.ts) — lets downstream consumers (audit, PDF, UI) tell it apart from
  // a real modification line item.
  isCalloutFee?: boolean;
}

export interface ModificationSubtotal {
  modificationCode: ModificationCode | "UNSPECIFIED";
  modificationLabel: string;
  total: number;
}

export interface RefinedEstimate {
  lineItems: RefinedEstimateLineItem[];
  modificationTotals: ModificationSubtotal[];
  subtotal: number;
  laborTotal: number;
  markupTotal: number;
  total: number;
  estimateMin: number;
  estimateMax: number;
}

const MODIFICATION_GROUP_ORDER: (ModificationCode | "UNSPECIFIED")[] = [
  ...Object.values(MODIFICATION_CODES),
  "UNSPECIFIED",
];

// Excludes call-out fee line items: the fee is a flat per-visit dispatch
// charge, not tied to any modification, so it doesn't belong in a per-
// modification breakdown (and would otherwise inflate the "UNSPECIFIED"
// bucket on every quote, since it also carries no modificationCode).
export function computeModificationTotals(lineItems: RefinedEstimateLineItem[]): ModificationSubtotal[] {
  const totals = new Map<ModificationCode | "UNSPECIFIED", number>();

  for (const item of lineItems) {
    if (item.isCalloutFee) continue;
    const key = item.modificationCode ?? "UNSPECIFIED";
    totals.set(key, (totals.get(key) ?? 0) + item.lineTotal);
  }

  return MODIFICATION_GROUP_ORDER.filter((key) => totals.has(key)).map((key) => ({
    modificationCode: key,
    modificationLabel: key === "UNSPECIFIED" ? UNSPECIFIED_MODIFICATION_LABEL : MODIFICATION_COST_CATALOG[key].label,
    total: roundToCents(totals.get(key)!),
  }));
}

function roundToCents(value: number): number {
  return Number(value.toFixed(2));
}

function buildLaborForItem(quantity: number, materialUnitCost: number): { laborHours: number; laborRate: number } {
  const baseHours = Math.max(1, Math.round(quantity * 1.5));
  const complexityBonus = Math.min(5, Math.floor(materialUnitCost / 500));
  const laborHours = baseHours + complexityBonus;
  return { laborHours, laborRate: LABOR_RATE_PER_HOUR };
}

function formatQuery(item: QuoteItem): string {
  if (item.modificationCode) {
    return MODIFICATION_COST_CATALOG[item.modificationCode].searchQuery;
  }
  return item.description.trim();
}

// Reject SERP matches priced below 40% of the catalog anchor (or item.unitPrice, for
// line items with no modificationCode) as implausible mismatches for that item.
const FLOOR_RATIO = 0.4;

type PriceCandidatesResultLike = PriceCandidatesResult | null;
export interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
  modificationCode?: ModificationCode;
}

function catalogAnchorPrice(item: QuoteItem): number {
  const catalogEntry = item.modificationCode ? MODIFICATION_COST_CATALOG[item.modificationCode] : undefined;
  return catalogEntry?.fallbackUnitPrice ?? item.unitPrice ?? 150;
}

async function fetchPriceResults(items: QuoteItem[]): Promise<PriceCandidatesResultLike[]> {
  const results: PriceCandidatesResultLike[] = [];

  for (const item of items) {
    try {
      const floorPrice = roundToCents(catalogAnchorPrice(item) * FLOOR_RATIO);
      results.push(await getMaterialPriceCandidates(formatQuery(item), { floorPrice }));
    } catch {
      results.push(null);
    }
  }

  return results;
}

// Caps how far the premium pick can sit above the economy pick, so a wild outlier
// in the SerpAPI results can't become "premium" on its own.
const PREMIUM_CAP_MULTIPLIER = 2.5;

interface TierPriceSelection {
  economy: PriceCandidate | null;
  standard: PriceCandidate | null;
  premium: PriceCandidate | null;
  // Set (and economy/standard/premium all null) whenever this item can't be tiered
  // from real SerpAPI data, so buildLineItemForTier knows both that it must fall
  // back to catalog pricing and why, for the audit trail.
  fallbackReason: PricingFallbackReason | null;
}

// Picks three distinct, genuinely different-priced products straight off the same
// fetched (and floor-filtered) candidate list, instead of one match marked up by a
// fixed multiplier:
//  - economy: the same cheapest/preferred-store pick used everywhere else.
//  - premium: the most expensive candidate at or below economy's price x
//    PREMIUM_CAP_MULTIPLIER, so it's capped rather than able to land on an outlier.
//  - standard: the median of that same capped window, so it always falls between
//    economy and premium and — like them — is a real candidate, not an average.
// `candidates` is price-ascending (see pricing.ts), which every step here relies on.
//
// If fewer than two candidates survive the premium cap (no candidates at all, or
// only the economy pick itself), there isn't enough real spread to trust for
// tiering, so every tier falls back to catalog pricing together instead of the
// line item showing three "different" prices that are secretly the same product —
// mirrors the eligibility HEURISTIC-fallback pattern (Step 3.5 in
// src/backend/eligibility/service.ts): fall back and record why, rather than
// silently accepting a bad spread.
function selectTierPrices(priceResult: PriceCandidatesResultLike): TierPriceSelection {
  const candidates = priceResult?.candidates ?? [];
  const economy = pickBestCandidate(candidates);

  if (!economy) {
    return { economy: null, standard: null, premium: null, fallbackReason: "no_usable_price" };
  }

  const premiumCap = economy.price * PREMIUM_CAP_MULTIPLIER;
  const usable = candidates.filter((candidate) => candidate.price >= economy.price && candidate.price <= premiumCap);

  // < 2, not < 3: this guards against total collapse (premium === economy), not
  // against "fewer than 3 distinct products." At exactly 2 usable candidates,
  // standard's lower-median pick below coincides with economy (same product,
  // different labor rate only) — accepted deliberately, so a line item still
  // gets *some* real differentiation instead of falling back to synthetic
  // catalog pricing every time SerpAPI returns only two plausible matches.
  if (usable.length < 2) {
    return { economy: null, standard: null, premium: null, fallbackReason: "implausible_tier_spread" };
  }

  const premium = usable[usable.length - 1];
  const standard = usable[Math.floor((usable.length - 1) / 2)];

  return { economy, standard, premium, fallbackReason: null };
}

// Used only when a line item falls back to catalog pricing (see TierPriceSelection
// above). Spreads the single catalog/unitPrice anchor into three price points with
// the same ratios the old per-tier materialMultiplier used, purely so fallback
// tiers still differ from one another — this is NOT the removed materialMultiplier
// field and isn't used once real candidates are available.
const FALLBACK_TIER_RATIO: Record<PricingTierKey, number> = {
  economy: 0.85,
  standard: 1,
  premium: 1.25,
};

function buildLineItemForTier(
  item: QuoteItem,
  tierSelection: TierPriceSelection,
  serpStatus: string,
  tierKey: PricingTierKey,
  tierAdjustment: PricingTierAdjustment
): RefinedEstimateLineItem {
  const selectedCandidate = tierSelection[tierKey];
  const usedSerpPrice = selectedCandidate !== null;
  const catalogEntry = item.modificationCode ? MODIFICATION_COST_CATALOG[item.modificationCode] : undefined;
  const query = formatQuery(item);
  const fallbackUnitPrice = roundToCents(catalogAnchorPrice(item) * FALLBACK_TIER_RATIO[tierKey]);
  const fallbackReason = tierSelection.fallbackReason ?? "no_usable_price";

  if (!usedSerpPrice) {
    logFallbackPricingUsed({
      description: item.description,
      modificationCode: item.modificationCode,
      query,
      serpStatus,
      reason: fallbackReason,
      fallbackUnitPrice,
    });
  }

  const materialUnitCost = roundToCents(usedSerpPrice ? selectedCandidate!.price : fallbackUnitPrice);
  const { laborHours, laborRate } = buildLaborForItem(item.quantity, materialUnitCost);
  const materialTotal = roundToCents(materialUnitCost * item.quantity);
  const laborTotalForLine = roundToCents(laborHours * laborRate);
  const lineBase = materialTotal + laborTotalForLine;
  const markupPercentage = tierAdjustment.markupPercentage;
  const markupTotalForLine = roundToCents(lineBase * markupPercentage);
  const lineTotal = roundToCents(lineBase + markupTotalForLine);

  return {
    description: item.description,
    quantity: item.quantity,
    pricingQuery: query,
    pricingSource: usedSerpPrice ? (selectedCandidate!.store ?? selectedCandidate!.name) : "fallback",
    pricingLink: usedSerpPrice ? selectedCandidate!.link : null,
    modificationCode: item.modificationCode ?? null,
    modificationLabel: catalogEntry?.label ?? null,
    materialUnitCost,
    materialTotal,
    laborHours,
    laborRate,
    laborTotal: laborTotalForLine,
    markupPercentage,
    markupTotal: markupTotalForLine,
    lineTotal,
    fallbackReason: usedSerpPrice ? null : fallbackReason,
  };
}

// Synthetic line item buildEstimateForTier appends, unconditionally, to every
// tier's estimate — a flat dispatch fee (CALL_OUT_FEE) stacked on top of the
// computed material + labor total, visible and auditable on its own line
// rather than folded into a modification's labor total.
function buildCalloutFeeLineItem(): RefinedEstimateLineItem {
  return {
    description: "Service Call-Out Fee",
    quantity: 1,
    pricingQuery: "",
    pricingSource: null,
    pricingLink: null,
    modificationCode: null,
    modificationLabel: null,
    materialUnitCost: 0,
    materialTotal: 0,
    laborHours: 0,
    laborRate: 0,
    laborTotal: CALL_OUT_FEE,
    markupPercentage: 0,
    markupTotal: 0,
    lineTotal: CALL_OUT_FEE,
    fallbackReason: null,
    isCalloutFee: true,
  };
}

function buildEstimateForTier(
  items: QuoteItem[],
  priceResults: PriceCandidatesResultLike[],
  tierSelections: TierPriceSelection[],
  tierKey: PricingTierKey,
  tierAdjustment: PricingTierAdjustment
): RefinedEstimate {
  const lineItems = items.map((item, index) =>
    buildLineItemForTier(
      item,
      tierSelections[index],
      priceResults[index]?.status ?? "no_result",
      tierKey,
      tierAdjustment
    )
  );

  let subtotal = 0;
  let laborTotal = 0;
  let markupTotal = 0;

  for (const lineItem of lineItems) {
    subtotal += lineItem.materialTotal + lineItem.laborTotal;
    laborTotal += lineItem.laborTotal;
    markupTotal += lineItem.markupTotal;
  }

  lineItems.push(buildCalloutFeeLineItem());
  subtotal += CALL_OUT_FEE;
  laborTotal += CALL_OUT_FEE;

  subtotal = roundToCents(subtotal);
  laborTotal = roundToCents(laborTotal);
  markupTotal = roundToCents(markupTotal);
  const total = roundToCents(subtotal + markupTotal);
  const estimateMin = roundToCents(total * 0.95);
  const estimateMax = roundToCents(total * 1.05);

  return {
    lineItems,
    modificationTotals: computeModificationTotals(lineItems),
    subtotal,
    laborTotal,
    markupTotal,
    total,
    estimateMin,
    estimateMax,
  };
}

export async function generateMockRefinedEstimate(
  items: QuoteItem[],
  modificationCodes: ModificationCode[] = []
): Promise<AnyRefinedEstimate> {
  const priceResults = await fetchPriceResults(items);
  const tierSelections = priceResults.map(selectTierPrices);
  const applicableTiers = getApplicableTiers(modificationCodes);

  if (applicableTiers.length === 0) {
    return buildEstimateForTier(
      items,
      priceResults,
      tierSelections,
      DEFAULT_PRICING_TIER,
      PRICING_TIER_CONFIG[DEFAULT_PRICING_TIER]
    );
  }

  const tiers = {} as Record<PricingTierKey, RefinedEstimate>;
  for (const tier of applicableTiers) {
    tiers[tier] = buildEstimateForTier(items, priceResults, tierSelections, tier, PRICING_TIER_CONFIG[tier]);
  }

  const tieredEstimate: TieredRefinedEstimate = { tiers };
  return tieredEstimate;
}
