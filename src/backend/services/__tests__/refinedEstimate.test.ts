import { MODIFICATION_CODES } from "@/backend/eligibility/types";
import { isTieredEstimate } from "@/backend/services/pricingTiers";
import { CALL_OUT_FEE } from "@/backend/services/laborRates";

jest.mock("@/backend/services/pricing", () => {
  const actual = jest.requireActual("@/backend/services/pricing");
  return {
    ...actual,
    getMaterialPriceCandidates: jest.fn(),
  };
});

import { getMaterialPriceCandidates, type PriceCandidatesResult } from "@/backend/services/pricing";
import { generateMockRefinedEstimate } from "@/backend/services/refinedEstimate";

const mockedGetMaterialPriceCandidates = getMaterialPriceCandidates as jest.MockedFunction<
  typeof getMaterialPriceCandidates
>;

function candidatesResult(
  query: string,
  candidates: PriceCandidatesResult["candidates"],
  status: PriceCandidatesResult["status"] = "ok"
): PriceCandidatesResult {
  return { query, status, candidates, fetchedAt: "2026-06-15T10:00:00.000Z" };
}

const homeDepotCandidate = {
  name: "Grab bar",
  price: 200,
  currency: "$200",
  store: "Home Depot",
  link: "https://example.com",
  thumbnail: null,
  isPreferredStore: true,
};

// A second, pricier candidate so the default mock has enough real spread to
// avoid tripping the implausible-tier-spread fallback (see the dedicated test
// for that below) — a single candidate can no longer differentiate three tiers.
const secondaryCandidate = {
  name: "Grab bar (Overstock)",
  price: 250,
  currency: "$250",
  store: "Overstock",
  link: "https://example.com/overstock",
  thumbnail: null,
  isPreferredStore: false,
};

const okResult = candidatesResult("Grab bars", [homeDepotCandidate, secondaryCandidate]);
const emptyResult = candidatesResult("Grab bars", [], "empty");

function candidate(price: number, store: string, isPreferredStore = false) {
  return {
    name: `Grab bar (${store})`,
    price,
    currency: `$${price}`,
    store,
    link: `https://example.com/${store}`,
    thumbnail: null,
    isPreferredStore,
  };
}

describe("generateMockRefinedEstimate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetMaterialPriceCandidates.mockResolvedValue(okResult);
  });

  it("tags the line item pricingSource as the store when SerpAPI returns a real price", async () => {
    const result = await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 150 },
    ]);

    expect(isTieredEstimate(result)).toBe(false);
    if (!isTieredEstimate(result)) {
      expect(result.lineItems[0].pricingSource).toBe("Home Depot");
      expect(result.lineItems[0].materialUnitCost).toBe(200);
    }
  });

  it("falls back to the item's unitPrice and tags pricingSource as fallback when SerpAPI has no usable candidates", async () => {
    mockedGetMaterialPriceCandidates.mockResolvedValue(emptyResult);

    const result = await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 150 },
    ]);

    expect(isTieredEstimate(result)).toBe(false);
    if (!isTieredEstimate(result)) {
      expect(result.lineItems[0].pricingSource).toBe("fallback");
      expect(result.lineItems[0].pricingLink).toBeNull();
      expect(result.lineItems[0].materialUnitCost).toBe(150);
    }
  });

  it("queries SerpAPI with the catalog search query and a floor price of 40% of the catalog anchor", async () => {
    await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 150, modificationCode: MODIFICATION_CODES.GRAB_BARS },
    ]);

    // MODIFICATION_COST_CATALOG.GRAB_BARS.fallbackUnitPrice is 180 -> floor = 180 * 0.4 = 72
    expect(mockedGetMaterialPriceCandidates).toHaveBeenCalledWith("ADA grab bar bathroom safety rail", {
      floorPrice: 72,
    });
  });

  it("falls back to the catalog price (not item.unitPrice) and logs a warning when SerpAPI has no usable candidates and a modificationCode is present", async () => {
    mockedGetMaterialPriceCandidates.mockResolvedValue(emptyResult);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 999, modificationCode: MODIFICATION_CODES.GRAB_BARS },
    ]);

    expect(isTieredEstimate(result)).toBe(false);
    if (!isTieredEstimate(result)) {
      expect(result.lineItems[0].materialUnitCost).toBe(180);
      expect(result.lineItems[0].modificationCode).toBe("GRAB_BARS");
      expect(result.lineItems[0].modificationLabel).toBe("Grab Bars");
    }
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[PRICING:FALLBACK]"));
    warnSpy.mockRestore();
  });

  it("tags line items with a null modificationCode/modificationLabel when none is provided", async () => {
    const result = await generateMockRefinedEstimate([
      { description: "Ramp", quantity: 1, unitPrice: 150 },
    ]);

    expect(isTieredEstimate(result)).toBe(false);
    if (!isTieredEstimate(result)) {
      expect(result.lineItems[0].modificationCode).toBeNull();
      expect(result.lineItems[0].modificationLabel).toBeNull();
    }
  });

  it("returns three itemized tiers for any declared modification code, since all support tiering by default", async () => {
    const result = await generateMockRefinedEstimate(
      [{ description: "Grab bars", quantity: 2, unitPrice: 150 }],
      [MODIFICATION_CODES.GRAB_BARS]
    );

    expect(isTieredEstimate(result)).toBe(true);
    if (isTieredEstimate(result)) {
      expect(Object.keys(result.tiers).sort()).toEqual(["economy", "premium", "standard"]);
      // The one modification line item, plus the always-added call-out fee line.
      expect(result.tiers.standard.lineItems).toHaveLength(2);
      expect(result.tiers.standard.total).toBeGreaterThan(0);
    }
  });

  it("returns a single estimate when called with no modification codes", async () => {
    const result = await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 150 },
    ]);

    expect(isTieredEstimate(result)).toBe(false);
  });

  it("returns three itemized tiers when a modification code supports tiering", async () => {
    // Needs a genuine 3-way material price spread: with labor now billed flat
    // across tiers (see the "labor rate and minimum call-out fee" describe block
    // below), only two usable candidates would make economy and standard land on
    // the same product/price, collapsing the distinction this test checks for.
    mockedGetMaterialPriceCandidates.mockResolvedValue(
      candidatesResult("Walk-in shower", [
        candidate(1500, "AliExpress"),
        candidate(2000, "Amazon"),
        candidate(2500, "Wayfair"),
      ])
    );

    const result = await generateMockRefinedEstimate(
      [{ description: "Walk-in shower", quantity: 1, unitPrice: 2000 }],
      [MODIFICATION_CODES.WALK_IN_SHOWER]
    );

    expect(isTieredEstimate(result)).toBe(true);
    if (isTieredEstimate(result)) {
      expect(Object.keys(result.tiers).sort()).toEqual(["economy", "premium", "standard"]);
      expect(result.tiers.economy.total).toBeLessThan(result.tiers.standard.total);
      expect(result.tiers.standard.total).toBeLessThan(result.tiers.premium.total);
    }
  });

  it("selects three distinct real candidates for economy/standard/premium instead of marking up one price", async () => {
    mockedGetMaterialPriceCandidates.mockResolvedValue(
      candidatesResult("Grab bars", [
        candidate(50, "AliExpress"),
        candidate(70, "Amazon"),
        candidate(100, "Wayfair"),
        candidate(110, "Overstock"),
      ])
    );

    const result = await generateMockRefinedEstimate(
      [{ description: "Grab bars", quantity: 1, unitPrice: 150 }],
      [MODIFICATION_CODES.GRAB_BARS]
    );

    expect(isTieredEstimate(result)).toBe(true);
    if (!isTieredEstimate(result)) return;

    expect(result.tiers.economy.lineItems[0].materialUnitCost).toBe(50);
    expect(result.tiers.economy.lineItems[0].pricingSource).toBe("AliExpress");
    expect(result.tiers.standard.lineItems[0].materialUnitCost).toBe(70);
    expect(result.tiers.standard.lineItems[0].pricingSource).toBe("Amazon");
    expect(result.tiers.premium.lineItems[0].materialUnitCost).toBe(110);
    expect(result.tiers.premium.lineItems[0].pricingSource).toBe("Overstock");
  });

  it("caps the premium pick so a wild outlier candidate can't become premium", async () => {
    mockedGetMaterialPriceCandidates.mockResolvedValue(
      candidatesResult("Grab bars", [
        candidate(50, "AliExpress"),
        candidate(60, "Amazon"),
        candidate(70, "Wayfair"),
        candidate(5000, "LuxeSupply"),
      ])
    );

    const result = await generateMockRefinedEstimate(
      [{ description: "Grab bars", quantity: 1, unitPrice: 150 }],
      [MODIFICATION_CODES.GRAB_BARS]
    );

    expect(isTieredEstimate(result)).toBe(true);
    if (!isTieredEstimate(result)) return;

    expect(result.tiers.premium.lineItems[0].materialUnitCost).toBe(70);
    expect(result.tiers.premium.lineItems[0].pricingSource).not.toBe("LuxeSupply");
  });

  it("spreads the catalog fallback price across tiers with distinct ratios when no candidates are usable", async () => {
    mockedGetMaterialPriceCandidates.mockResolvedValue(emptyResult);

    const result = await generateMockRefinedEstimate(
      [{ description: "Grab bars", quantity: 1, unitPrice: 999, modificationCode: MODIFICATION_CODES.GRAB_BARS }],
      [MODIFICATION_CODES.GRAB_BARS]
    );

    expect(isTieredEstimate(result)).toBe(true);
    if (!isTieredEstimate(result)) return;

    // MODIFICATION_COST_CATALOG.GRAB_BARS.fallbackUnitPrice is 180
    expect(result.tiers.economy.lineItems[0].materialUnitCost).toBe(153);
    expect(result.tiers.standard.lineItems[0].materialUnitCost).toBe(180);
    expect(result.tiers.premium.lineItems[0].materialUnitCost).toBe(225);
    expect(result.tiers.economy.lineItems[0].pricingSource).toBe("fallback");
    expect(result.tiers.economy.lineItems[0].fallbackReason).toBe("no_usable_price");
  });

  it("falls back to catalog pricing for every tier when only one candidate survives the premium cap, tagging the reason as implausible_tier_spread", async () => {
    mockedGetMaterialPriceCandidates.mockResolvedValue(
      candidatesResult("Grab bars", [candidate(200, "Home Depot", true)])
    );
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await generateMockRefinedEstimate(
      [{ description: "Grab bars", quantity: 1, unitPrice: 999, modificationCode: MODIFICATION_CODES.GRAB_BARS }],
      [MODIFICATION_CODES.GRAB_BARS]
    );

    expect(isTieredEstimate(result)).toBe(true);
    if (!isTieredEstimate(result)) return;

    // MODIFICATION_COST_CATALOG.GRAB_BARS.fallbackUnitPrice is 180 — the single real
    // $200 match isn't reused across all three tiers; it's discarded in favor of the
    // catalog-anchored fallback spread, since one product can't differentiate three tiers.
    expect(result.tiers.economy.lineItems[0].pricingSource).toBe("fallback");
    expect(result.tiers.economy.lineItems[0].fallbackReason).toBe("implausible_tier_spread");
    expect(result.tiers.economy.lineItems[0].materialUnitCost).toBe(153);
    expect(result.tiers.standard.lineItems[0].materialUnitCost).toBe(180);
    expect(result.tiers.premium.lineItems[0].materialUnitCost).toBe(225);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("reason=implausible_tier_spread"));
    warnSpy.mockRestore();
  });

  it("produces tiers when at least one of several modification codes supports tiering", async () => {
    const result = await generateMockRefinedEstimate(
      [
        { description: "Grab bars", quantity: 1, unitPrice: 150 },
        { description: "Walk-in shower", quantity: 1, unitPrice: 2000 },
      ],
      [MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.WALK_IN_SHOWER]
    );

    expect(isTieredEstimate(result)).toBe(true);
  });
});

describe("labor rate and call-out fee", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetMaterialPriceCandidates.mockResolvedValue(okResult);
  });

  it("charges labor at a flat $150/hr on every tier, since tiers no longer vary the labor rate", async () => {
    const result = await generateMockRefinedEstimate(
      [{ description: "Walk-in shower", quantity: 1, unitPrice: 2000 }],
      [MODIFICATION_CODES.WALK_IN_SHOWER]
    );

    expect(isTieredEstimate(result)).toBe(true);
    if (!isTieredEstimate(result)) return;

    expect(result.tiers.economy.lineItems[0].laborRate).toBe(150);
    expect(result.tiers.standard.lineItems[0].laborRate).toBe(150);
    expect(result.tiers.premium.lineItems[0].laborRate).toBe(150);
  });

  it("adds a $150 Service Call-Out Fee line item stacked on top of material + labor, even on a sizable job", async () => {
    const result = await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 150 },
    ]);

    expect(isTieredEstimate(result)).toBe(false);
    if (isTieredEstimate(result)) return;

    const calloutFeeLine = result.lineItems.find((item) => item.isCalloutFee);
    expect(calloutFeeLine).toBeDefined();
    expect(calloutFeeLine?.lineTotal).toBe(150);

    const materialAndLaborTotal = result.lineItems
      .filter((item) => !item.isCalloutFee)
      .reduce((sum, item) => sum + item.materialTotal + item.laborTotal, 0);
    expect(result.total).toBe(Number((materialAndLaborTotal + 150).toFixed(2)));
  });

  it("still adds the $150 call-out fee even when there are no billable line items", async () => {
    const result = await generateMockRefinedEstimate([]);

    expect(isTieredEstimate(result)).toBe(false);
    if (isTieredEstimate(result)) return;

    expect(result.lineItems).toHaveLength(1);
    const [calloutFeeLine] = result.lineItems;
    expect(calloutFeeLine.isCalloutFee).toBe(true);
    expect(calloutFeeLine.lineTotal).toBe(150);
    expect(result.total).toBe(150);
  });

  it("adds the call-out fee once per tier when tiered", async () => {
    const result = await generateMockRefinedEstimate(
      [{ description: "Walk-in shower", quantity: 1, unitPrice: 2000 }],
      [MODIFICATION_CODES.WALK_IN_SHOWER]
    );

    expect(isTieredEstimate(result)).toBe(true);
    if (!isTieredEstimate(result)) return;

    for (const tierKey of ["economy", "standard", "premium"] as const) {
      const calloutFeeLines = result.tiers[tierKey].lineItems.filter((item) => item.isCalloutFee);
      expect(calloutFeeLines).toHaveLength(1);
      expect(calloutFeeLines[0].lineTotal).toBe(150);
    }
  });
});

describe("modificationTotals", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetMaterialPriceCandidates.mockResolvedValue(okResult);
  });

  it("rolls up lineTotal by modificationCode and sums to the estimate total (non-tiered)", async () => {
    const result = await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 150, modificationCode: MODIFICATION_CODES.GRAB_BARS },
      { description: "Handrails", quantity: 1, unitPrice: 150, modificationCode: MODIFICATION_CODES.HANDRAILS },
      { description: "Ramp", quantity: 1, unitPrice: 150 },
    ]);

    expect(isTieredEstimate(result)).toBe(false);
    if (isTieredEstimate(result)) return;

    const codes = result.modificationTotals.map((t) => t.modificationCode);
    expect(codes).toEqual(["GRAB_BARS", "HANDRAILS", "UNSPECIFIED"]);

    // "UNSPECIFIED" here is only the Ramp item — the call-out fee is excluded
    // from modificationTotals entirely, since it isn't tied to a modification.
    const unspecified = result.modificationTotals.find((t) => t.modificationCode === "UNSPECIFIED");
    const rampItem = result.lineItems.find((i) => i.description === "Ramp");
    expect(unspecified?.total).toBe(rampItem?.lineTotal);

    const summedTotal = result.modificationTotals.reduce((sum, t) => sum + t.total, 0);
    expect(Number((summedTotal + CALL_OUT_FEE).toFixed(2))).toBe(result.total);
  });

  it("rolls up a newly added modification code (WALK_IN_TUB) the same as an established one", async () => {
    const result = await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 150, modificationCode: MODIFICATION_CODES.GRAB_BARS },
      { description: "Walk-in tub", quantity: 1, unitPrice: 5500, modificationCode: MODIFICATION_CODES.WALK_IN_TUB },
    ]);

    expect(isTieredEstimate(result)).toBe(false);
    if (isTieredEstimate(result)) return;

    const codes = result.modificationTotals.map((t) => t.modificationCode);
    expect(codes).toEqual(["GRAB_BARS", "WALK_IN_TUB"]);

    const summedTotal = result.modificationTotals.reduce((sum, t) => sum + t.total, 0);
    expect(Number((summedTotal + CALL_OUT_FEE).toFixed(2))).toBe(result.total);
  });

  it("keeps each tier's modificationTotals consistent with that tier's own total", async () => {
    const result = await generateMockRefinedEstimate(
      [
        { description: "Grab bars", quantity: 1, unitPrice: 150, modificationCode: MODIFICATION_CODES.GRAB_BARS },
        { description: "Walk-in shower", quantity: 1, unitPrice: 2000, modificationCode: MODIFICATION_CODES.WALK_IN_SHOWER },
      ],
      [MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.WALK_IN_SHOWER]
    );

    expect(isTieredEstimate(result)).toBe(true);
    if (!isTieredEstimate(result)) return;

    for (const tierKey of ["economy", "standard", "premium"] as const) {
      const tier = result.tiers[tierKey];
      const summedTotal = tier.modificationTotals.reduce((sum, t) => sum + t.total, 0);
      expect(Number((summedTotal + CALL_OUT_FEE).toFixed(2))).toBe(tier.total);
      expect(tier.modificationTotals.map((t) => t.modificationCode)).toEqual(["GRAB_BARS", "WALK_IN_SHOWER"]);
    }
  });
});
