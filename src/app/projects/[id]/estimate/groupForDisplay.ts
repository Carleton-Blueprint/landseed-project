import type { ModificationSubtotal, RefinedEstimateLineItem } from "@/backend/services/refinedEstimate";
import type { EstimateLineItemGroup } from "./EstimateClientComponent";

// Presentational grouping only — never persisted. modificationTotals (already computed
// and persisted on RefinedEstimate) supplies the totals and group order for the
// per-modification groups; this just buckets the already-tagged flat lineItems into
// arrays for rendering.
//
// The call-out fee line item is handled separately from modificationTotals-driven
// grouping: computeModificationTotals deliberately excludes it (it isn't tied to a
// modification), so without this it would silently vanish from every group here too.
// Appended as its own group instead, so the fee stays visible to the client and the
// displayed groups still sum to the tier/estimate total.
export function groupForDisplay(
  lineItems: RefinedEstimateLineItem[],
  modificationTotals: ModificationSubtotal[]
): EstimateLineItemGroup[] {
  const buckets = new Map<string, RefinedEstimateLineItem[]>();
  for (const item of lineItems) {
    if (item.isCalloutFee) continue;
    const key = item.modificationCode ?? "UNSPECIFIED";
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  const groups: EstimateLineItemGroup[] = modificationTotals.map((t) => ({
    modificationCode: t.modificationCode,
    modificationLabel: t.modificationLabel,
    lineItems: buckets.get(t.modificationCode) ?? [],
    total: t.total,
  }));

  const calloutFeeItems = lineItems.filter((item) => item.isCalloutFee);
  if (calloutFeeItems.length > 0) {
    const total = Number(calloutFeeItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
    groups.push({
      modificationCode: "CALL_OUT_FEE",
      modificationLabel: "Service Call-Out Fee",
      lineItems: calloutFeeItems,
      total,
    });
  }

  return groups;
}
