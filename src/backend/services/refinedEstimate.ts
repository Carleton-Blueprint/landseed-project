import { getMaterialPrice } from "@/backend/services/pricing";
import type { ModificationCode } from "@/backend/eligibility/types";
import { MODIFICATION_COST_CATALOG } from "@/backend/services/modificationCostCatalog";
import {
  DEFAULT_PRICING_TIER,
  getApplicableTiers,
  PRICING_TIER_CONFIG,
  type AnyRefinedEstimate,
  type PricingTierAdjustment,
  type PricingTierKey,
  type TieredRefinedEstimate,
} from "@/backend/services/pricingTiers";

const REFINED_ESTIMATE_DEBUG = (process.env.PRICING_DEBUG ?? "true").toLowerCase() !== "false";

function logFallbackPricingUsed(details: {
  description: string;
  modificationCode?: ModificationCode;
  query: string;
  serpStatus: string;
  fallbackUnitPrice: number;
}): void {
  if (!REFINED_ESTIMATE_DEBUG) return;
  const ts = new Date().toISOString();
  console.warn(
    `[PRICING:FALLBACK] ${ts} — Using fallback price for "${details.description}" ` +
      `(modificationCode=${details.modificationCode ?? "UNSPECIFIED"}, query="${details.query}", ` +
      `serpStatus=${details.serpStatus}) — fallbackUnitPrice=$${details.fallbackUnitPrice}`
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
}

export interface RefinedEstimate {
  lineItems: RefinedEstimateLineItem[];
  subtotal: number;
  laborTotal: number;
  markupTotal: number;
  total: number;
  estimateMin: number;
  estimateMax: number;
}

function roundToCents(value: number): number {
  return Number(value.toFixed(2));
}

function buildLaborForItem(quantity: number, materialUnitCost: number): { laborHours: number; laborRate: number } {
  const baseHours = Math.max(1, Math.round(quantity * 1.5));
  const complexityBonus = Math.min(5, Math.floor(materialUnitCost / 500));
  const laborHours = baseHours + complexityBonus;
  const laborRate = roundToCents(80 + Math.min(70, materialUnitCost / 25));
  return { laborHours, laborRate };
}

function formatQuery(item: QuoteItem): string {
  if (item.modificationCode) {
    return MODIFICATION_COST_CATALOG[item.modificationCode].searchQuery;
  }
  return item.description.trim();
}

type PriceResultLike = Awaited<ReturnType<typeof getMaterialPrice>> | null;
export interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
  modificationCode?: ModificationCode;
}

async function fetchPriceResults(items: QuoteItem[]): Promise<PriceResultLike[]> {
  const results: PriceResultLike[] = [];

  for (const item of items) {
    try {
      results.push(await getMaterialPrice(formatQuery(item)));
    } catch {
      results.push(null);
    }
  }

  return results;
}

function buildLineItemForTier(
  item: QuoteItem,
  priceResult: PriceResultLike,
  tierAdjustment: PricingTierAdjustment
): RefinedEstimateLineItem {
  const usedSerpPrice = priceResult?.status === "ok" && priceResult.price !== null;
  const catalogEntry = item.modificationCode ? MODIFICATION_COST_CATALOG[item.modificationCode] : undefined;
  const query = formatQuery(item);
  const fallbackUnitPrice = catalogEntry?.fallbackUnitPrice ?? item.unitPrice ?? 150;

  if (!usedSerpPrice) {
    logFallbackPricingUsed({
      description: item.description,
      modificationCode: item.modificationCode,
      query,
      serpStatus: priceResult?.status ?? "no_result",
      fallbackUnitPrice,
    });
  }

  const baseUnitCost = roundToCents(usedSerpPrice ? priceResult!.price! : fallbackUnitPrice);
  const materialUnitCost = roundToCents(baseUnitCost * tierAdjustment.materialMultiplier);
  const { laborHours, laborRate: baseLaborRate } = buildLaborForItem(item.quantity, baseUnitCost);
  const laborRate = roundToCents(baseLaborRate * tierAdjustment.laborMultiplier);
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
    pricingSource: usedSerpPrice ? (priceResult!.store ?? priceResult!.name) : "fallback",
    pricingLink: usedSerpPrice ? priceResult!.link : null,
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
  };
}

function buildEstimateForTier(
  items: QuoteItem[],
  priceResults: PriceResultLike[],
  tierAdjustment: PricingTierAdjustment
): RefinedEstimate {
  const lineItems = items.map((item, index) =>
    buildLineItemForTier(item, priceResults[index] ?? null, tierAdjustment)
  );

  let subtotal = 0;
  let laborTotal = 0;
  let markupTotal = 0;

  for (const lineItem of lineItems) {
    subtotal += lineItem.materialTotal + lineItem.laborTotal;
    laborTotal += lineItem.laborTotal;
    markupTotal += lineItem.markupTotal;
  }

  subtotal = roundToCents(subtotal);
  laborTotal = roundToCents(laborTotal);
  markupTotal = roundToCents(markupTotal);
  const total = roundToCents(subtotal + markupTotal);
  const estimateMin = roundToCents(total * 0.95);
  const estimateMax = roundToCents(total * 1.05);

  return {
    lineItems,
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
  const applicableTiers = getApplicableTiers(modificationCodes);

  if (applicableTiers.length === 0) {
    return buildEstimateForTier(items, priceResults, PRICING_TIER_CONFIG[DEFAULT_PRICING_TIER]);
  }

  const tiers = {} as Record<PricingTierKey, RefinedEstimate>;
  for (const tier of applicableTiers) {
    tiers[tier] = buildEstimateForTier(items, priceResults, PRICING_TIER_CONFIG[tier]);
  }

  const tieredEstimate: TieredRefinedEstimate = { tiers };
  return tieredEstimate;
}
