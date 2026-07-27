import { MODIFICATION_CODES } from "@/backend/eligibility/types";
import { isTieredEstimate } from "@/backend/services/pricingTiers";

jest.mock("@/backend/services/pricing", () => ({
  getMaterialPrice: jest.fn(),
}));

import { getMaterialPrice } from "@/backend/services/pricing";
import { generateMockRefinedEstimate } from "@/backend/services/refinedEstimate";

const mockedGetMaterialPrice = getMaterialPrice as jest.MockedFunction<typeof getMaterialPrice>;

const priceResult = {
  name: "Grab bar",
  price: 200,
  currency: "$200",
  store: "Home Depot",
  link: "https://example.com",
  thumbnail: null,
  query: "Grab bars",
  fetchedAt: "2026-06-15T10:00:00.000Z",
  status: "ok" as const,
};

const emptyPriceResult = {
  name: "Grab bars",
  price: null,
  currency: null,
  store: null,
  link: null,
  thumbnail: null,
  query: "Grab bars",
  fetchedAt: "2026-06-15T10:00:00.000Z",
  status: "empty" as const,
};

describe("generateMockRefinedEstimate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetMaterialPrice.mockResolvedValue(priceResult);
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

  it("falls back to the item's unitPrice and tags pricingSource as fallback when SerpAPI has no price", async () => {
    mockedGetMaterialPrice.mockResolvedValue(emptyPriceResult);

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

  it("queries SerpAPI with the catalog search query when a modificationCode is present", async () => {
    await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 150, modificationCode: MODIFICATION_CODES.GRAB_BARS },
    ]);

    expect(mockedGetMaterialPrice).toHaveBeenCalledWith("ADA grab bar bathroom safety rail");
  });

  it("falls back to the catalog price (not item.unitPrice) and logs a warning when SerpAPI has no price and a modificationCode is present", async () => {
    mockedGetMaterialPrice.mockResolvedValue(emptyPriceResult);
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

  it("returns a single estimate (no tiers) when no modification code supports tiering", async () => {
    const result = await generateMockRefinedEstimate(
      [{ description: "Grab bars", quantity: 2, unitPrice: 150 }],
      [MODIFICATION_CODES.GRAB_BARS]
    );

    expect(isTieredEstimate(result)).toBe(false);
    if (!isTieredEstimate(result)) {
      expect(result.lineItems).toHaveLength(1);
      expect(result.total).toBeGreaterThan(0);
    }
  });

  it("returns a single estimate when called with no modification codes", async () => {
    const result = await generateMockRefinedEstimate([
      { description: "Grab bars", quantity: 1, unitPrice: 150 },
    ]);

    expect(isTieredEstimate(result)).toBe(false);
  });

  it("returns three itemized tiers when a modification code supports tiering", async () => {
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

describe("modificationTotals", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetMaterialPrice.mockResolvedValue(priceResult);
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

    const unspecified = result.modificationTotals.find((t) => t.modificationCode === "UNSPECIFIED");
    const rampItem = result.lineItems.find((i) => i.description === "Ramp");
    expect(unspecified?.total).toBe(rampItem?.lineTotal);

    const summedTotal = result.modificationTotals.reduce((sum, t) => sum + t.total, 0);
    expect(Number(summedTotal.toFixed(2))).toBe(result.total);
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
      expect(Number(summedTotal.toFixed(2))).toBe(tier.total);
      expect(tier.modificationTotals.map((t) => t.modificationCode)).toEqual(["GRAB_BARS", "WALK_IN_SHOWER"]);
    }
  });
});
