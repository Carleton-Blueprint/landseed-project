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
