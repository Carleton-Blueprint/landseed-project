import { getMaterialPrice } from "@/backend/services/pricing";

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

export async function generateMockRefinedEstimate(
  items: Array<{ description: string; quantity: number; unitPrice: number }>
): Promise<RefinedEstimate> {
  const lineItems: RefinedEstimateLineItem[] = [];
  let subtotal = 0;
  let laborTotal = 0;
  let markupTotal = 0;

  for (const item of items) {
    const pricingQuery = formatQuery(item.description);
    let priceResult;

    try {
      priceResult = await getMaterialPrice(pricingQuery);
    } catch {
      priceResult = null;
    }

    const materialUnitCost = roundToCents(
      priceResult?.price ?? item.unitPrice ?? 150
    );
    const { laborHours, laborRate } = buildLaborForItem(item.quantity, materialUnitCost);
    const materialTotal = roundToCents(materialUnitCost * item.quantity);
    const laborTotalForLine = roundToCents(laborHours * laborRate);
    const lineBase = materialTotal + laborTotalForLine;
    const markupPercentage = 0.15;
    const markupTotalForLine = roundToCents(lineBase * markupPercentage);
    const lineTotal = roundToCents(lineBase + markupTotalForLine);

    lineItems.push({
      description: item.description,
      quantity: item.quantity,
      pricingQuery,
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
    });

    subtotal += materialTotal + laborTotalForLine;
    laborTotal += laborTotalForLine;
    markupTotal += markupTotalForLine;
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
