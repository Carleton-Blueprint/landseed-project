/**
 * @jest-environment node
 */
import {
  buildBuilderTrendWorkOrderPayload,
  resolveBuilderTrendPricingBreakdown,
  BUILDER_TREND_WORK_ORDER_PAYLOAD_SCHEMA_VERSION,
} from "../builderTrendPayload";
import type { RefinedEstimate } from "@/backend/services/refinedEstimate";
import type { TieredRefinedEstimate } from "@/backend/services/pricingTiers";

function buildEstimate(total: number): RefinedEstimate {
  return {
    lineItems: [
      {
        description: "Walk-in shower",
        quantity: 1,
        pricingQuery: "Walk-in shower",
        pricingSource: "Home Depot",
        pricingLink: null,
        materialUnitCost: total * 0.5,
        materialTotal: total * 0.5,
        laborHours: 4,
        laborRate: total * 0.1,
        laborTotal: total * 0.2,
        markupPercentage: 0.15,
        markupTotal: total * 0.15,
        lineTotal: total,
      },
    ],
    modificationTotals: [],
    subtotal: total * 0.7,
    laborTotal: total * 0.2,
    markupTotal: total * 0.15,
    total,
    estimateMin: total * 0.95,
    estimateMax: total * 1.05,
  };
}

const baseQuoteRow = { subtotal: 1300, total: 1300, estimateMin: 1235, estimateMax: 1365 };

describe("resolveBuilderTrendPricingBreakdown", () => {
  it("uses the accepted tier's own totals, not the Quote row's stored totals", () => {
    const tiered: TieredRefinedEstimate = {
      tiers: { economy: buildEstimate(1000), standard: buildEstimate(1300), premium: buildEstimate(1700) },
    };

    const breakdown = resolveBuilderTrendPricingBreakdown({
      quote: baseQuoteRow,
      refinedEstimate: tiered,
      quoteIsTiered: true,
      acceptedTier: "premium",
    });

    expect(breakdown.total).toBe(1700);
    expect(breakdown.lineItems).toHaveLength(1);
    expect(breakdown.selectedTier).toBe("premium");
  });

  it("uses the flat refinedEstimate when the quote isn't tiered", () => {
    const breakdown = resolveBuilderTrendPricingBreakdown({
      quote: baseQuoteRow,
      refinedEstimate: buildEstimate(500),
      quoteIsTiered: false,
      acceptedTier: null,
    });

    expect(breakdown.total).toBe(500);
    expect(breakdown.lineItems).toHaveLength(1);
    expect(breakdown.selectedTier).toBeNull();
  });

  it("falls back to the Quote row's totals with empty lineItems when no refinedEstimate breakdown exists", () => {
    const breakdown = resolveBuilderTrendPricingBreakdown({
      quote: baseQuoteRow,
      refinedEstimate: null,
      quoteIsTiered: false,
      acceptedTier: null,
    });

    expect(breakdown.total).toBe(1300);
    expect(breakdown.subtotal).toBe(1300);
    expect(breakdown.lineItems).toEqual([]);
  });
});

describe("buildBuilderTrendWorkOrderPayload", () => {
  it("packages only summary-level client, project, modification type, and total estimate fields", () => {
    const payload = buildBuilderTrendWorkOrderPayload({
      project: {
        id: "proj-1",
        address: "123 Main St",
        user: { name: "Jane Client", email: "jane@example.com", phone: "555-0100" },
        photos: [{ declaredModificationCodes: ["WALK_IN_SHOWER", "GRAB_BARS"] }],
      },
      quote: baseQuoteRow,
      refinedEstimate: buildEstimate(500),
      quoteIsTiered: false,
      acceptedTier: null,
    });

    expect(payload).toEqual({
      schemaVersion: BUILDER_TREND_WORK_ORDER_PAYLOAD_SCHEMA_VERSION,
      project: { id: "proj-1", address: "123 Main St" },
      client: { name: "Jane Client", email: "jane@example.com", phone: "555-0100" },
      modificationType: ["Grab Bars", "Walk-In Shower"],
      totalEstimate: 500,
    });
  });

  it("never includes raw itemized data (line items, photo URLs, or attachment fields)", () => {
    const payload = buildBuilderTrendWorkOrderPayload({
      project: {
        id: "proj-1",
        address: "123 Main St",
        user: { name: null, email: null, phone: null },
        photos: [{ declaredModificationCodes: [] }],
      },
      quote: baseQuoteRow,
      refinedEstimate: buildEstimate(500),
      quoteIsTiered: false,
      acceptedTier: null,
    });

    expect(payload).not.toHaveProperty("quote");
    expect(payload).not.toHaveProperty("photos");
    expect(payload).not.toHaveProperty("attachments");
    expect(Object.keys(payload).sort()).toEqual(
      ["client", "modificationType", "project", "schemaVersion", "totalEstimate"].sort()
    );
  });

  it("uses the accepted tier's total for a tiered quote", () => {
    const tiered: TieredRefinedEstimate = {
      tiers: { economy: buildEstimate(1000), standard: buildEstimate(1300), premium: buildEstimate(1700) },
    };

    const payload = buildBuilderTrendWorkOrderPayload({
      project: {
        id: "proj-1",
        address: "123 Main St",
        user: { name: null, email: null, phone: null },
        photos: [],
      },
      quote: baseQuoteRow,
      refinedEstimate: tiered,
      quoteIsTiered: true,
      acceptedTier: "premium",
    });

    expect(payload.totalEstimate).toBe(1700);
  });

  it("falls back to the Quote row's total when no refinedEstimate breakdown exists", () => {
    const payload = buildBuilderTrendWorkOrderPayload({
      project: {
        id: "proj-1",
        address: "123 Main St",
        user: { name: null, email: null, phone: null },
        photos: [],
      },
      quote: baseQuoteRow,
      refinedEstimate: null,
      quoteIsTiered: false,
      acceptedTier: null,
    });

    expect(payload.totalEstimate).toBe(1300);
    expect(payload.modificationType).toEqual([]);
    expect(payload.client).toEqual({ name: null, email: null, phone: null });
  });
});
