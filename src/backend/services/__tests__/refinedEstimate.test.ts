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
};

describe("generateMockRefinedEstimate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetMaterialPrice.mockResolvedValue(priceResult);
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
