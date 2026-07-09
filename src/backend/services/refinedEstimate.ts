import { getMaterialPrice } from "@/backend/services/pricing";
import type { ModificationCode } from "@/backend/eligibility/types";
import {
  DEFAULT_PRICING_TIER,
  getApplicableTiers,
  PRICING_TIER_CONFIG,
  type AnyRefinedEstimate,
  type PricingTierAdjustment,
  type PricingTierKey,
  type TieredRefinedEstimate,
} from "@/backend/services/pricingTiers";

export interface RefinedEstimateLineItem {
  description: string;
  quantity: number;
  pricingQuery: string;
  pricingSource?: string | null;
  pricingLink?: string | null;
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

function formatQuery(description: string): string {
  return description.trim();
}

type PriceResultLike = Awaited<ReturnType<typeof getMaterialPrice>> | null;
type QuoteItem = { description: string; quantity: number; unitPrice: number };

async function fetchPriceResults(items: QuoteItem[]): Promise<PriceResultLike[]> {
  const results: PriceResultLike[] = [];

  for (const item of items) {
    try {
      results.push(await getMaterialPrice(formatQuery(item.description)));
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
  const baseUnitCost = roundToCents(priceResult?.price ?? item.unitPrice ?? 150);
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
    pricingQuery: formatQuery(item.description),
    pricingSource: priceResult?.store ?? priceResult?.name ?? null,
    pricingLink: priceResult?.link ?? null,
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
