import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    quote: {
      findUnique: jest.fn(),
    },
  },
}));

type QuoteRecord = {
  id: string;
  projectId: string;
  subtotal: number;
  total: number;
  estimateMin: number | null;
  estimateMax: number | null;
  refinedEstimate: unknown;
  override?: {
    subtotal: number;
    total: number;
    lineItems: Array<{ description: string; quantity: number; materialTotal: number; laborTotal: number }>;
  } | null;
  project: {
    id: string;
    address: string | null;
    draftData: unknown;
    user: { name: string | null };
    photos: Array<{ declaredModificationCodes: string[] }>;
    manualModeSubmission?: { modificationType: string | null } | null;
  };
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: {
    quote: {
      findUnique: jest.Mock<(...args: unknown[]) => Promise<QuoteRecord | null>>;
    };
  };
};

const { assembleEstimateInput, resolvePricingBreakdown } = require("../estimateAssembler") as {
  resolvePricingBreakdown: (input: {
    quote: {
      subtotal: number;
      total: number;
      estimateMin: number | null;
      estimateMax: number | null;
    };
    refinedEstimate: unknown;
    quoteIsTiered: boolean;
    acceptedTier: "economy" | "standard" | "premium" | null;
  }) => {
    selectedTier: string | null;
    lineItems: unknown[];
    subtotal: number;
    laborTotal: number;
    markupTotal: number;
    total: number;
    estimateMin: number;
    estimateMax: number;
  };
  assembleEstimateInput: (quoteId: string) => Promise<{
    projectId: string;
    quoteId: string;
    clientName: string;
    projectAddress: string;
    modificationType: string;
    selectedTier: "economy" | "standard" | "premium" | null;
    pricing: {
      selectedTier: string | null;
      lineItems: unknown[];
      subtotal: number;
      laborTotal: number;
      markupTotal: number;
      total: number;
      estimateMin: number;
      estimateMax: number;
    };
    incompleteFields: string[];
    preparedAtIso: string;
    wasOverridden: boolean;
  }>;
};

const NON_TIERED_REFINED_ESTIMATE = {
  lineItems: [
    {
      description: "Grab bar install",
      quantity: 2,
      pricingQuery: "grab bar",
      materialUnitCost: 40,
      materialTotal: 80,
      laborHours: 3,
      laborRate: 90,
      laborTotal: 270,
      markupPercentage: 0,
      markupTotal: 0,
      lineTotal: 350,
    },
  ],
  modificationTotals: [],
  subtotal: 350,
  laborTotal: 270,
  markupTotal: 0,
  total: 350,
  estimateMin: 332.5,
  estimateMax: 367.5,
};

function buildEstimateForTier(total: number) {
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

const RESOLVE_PRICING_BASE_QUOTE_ROW = { subtotal: 1300, total: 1300, estimateMin: 1235, estimateMax: 1365 };

describe("resolvePricingBreakdown", () => {
  it("uses the accepted tier's own totals, not the Quote row's stored totals", () => {
    const tiered = {
      tiers: {
        economy: buildEstimateForTier(1000),
        standard: buildEstimateForTier(1300),
        premium: buildEstimateForTier(1700),
      },
    };

    const breakdown = resolvePricingBreakdown({
      quote: RESOLVE_PRICING_BASE_QUOTE_ROW,
      refinedEstimate: tiered,
      quoteIsTiered: true,
      acceptedTier: "premium",
    });

    expect(breakdown.total).toBe(1700);
    expect(breakdown.lineItems).toHaveLength(1);
    expect(breakdown.selectedTier).toBe("premium");
  });

  it("uses the flat refinedEstimate when the quote isn't tiered", () => {
    const breakdown = resolvePricingBreakdown({
      quote: RESOLVE_PRICING_BASE_QUOTE_ROW,
      refinedEstimate: buildEstimateForTier(500),
      quoteIsTiered: false,
      acceptedTier: null,
    });

    expect(breakdown.total).toBe(500);
    expect(breakdown.lineItems).toHaveLength(1);
    expect(breakdown.selectedTier).toBeNull();
  });

  it("falls back to the Quote row's totals with empty lineItems when no refinedEstimate breakdown exists", () => {
    const breakdown = resolvePricingBreakdown({
      quote: RESOLVE_PRICING_BASE_QUOTE_ROW,
      refinedEstimate: null,
      quoteIsTiered: false,
      acceptedTier: null,
    });

    expect(breakdown.total).toBe(1300);
    expect(breakdown.subtotal).toBe(1300);
    expect(breakdown.lineItems).toEqual([]);
  });
});

describe("assembleEstimateInput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("assembles client, address, modification type, and pricing for a non-tiered quote", async () => {
    prisma.quote.findUnique.mockResolvedValue({
      id: "quote-1",
      projectId: "proj-1",
      subtotal: 350,
      total: 350,
      estimateMin: 332.5,
      estimateMax: 367.5,
      refinedEstimate: NON_TIERED_REFINED_ESTIMATE,
      project: {
        id: "proj-1",
        address: "456 Fallback Rd",
        draftData: {
          addressLine1: "123 Main St",
          city: "Toronto",
          province: "ON",
          postalCode: "M5V 2T6",
        },
        user: { name: "Sam Applicant" },
        photos: [{ declaredModificationCodes: ["GRAB_BARS"] }],
      },
    });

    const result = await assembleEstimateInput("quote-1");

    expect(result).toMatchObject({
      projectId: "proj-1",
      quoteId: "quote-1",
      clientName: "Sam Applicant",
      projectAddress: "123 Main St, Toronto, ON, M5V 2T6",
      modificationType: "Grab Bars",
      selectedTier: null,
      incompleteFields: [],
    });
    expect(result.pricing).toMatchObject({
      subtotal: 350,
      laborTotal: 270,
      markupTotal: 0,
      total: 350,
      estimateMin: 332.5,
      estimateMax: 367.5,
      lineItems: NON_TIERED_REFINED_ESTIMATE.lineItems,
    });
  });

  it("resolves pricing from the selected tier for a tiered, accepted quote", async () => {
    const premiumTier = { ...NON_TIERED_REFINED_ESTIMATE, total: 500, subtotal: 500 };
    prisma.quote.findUnique.mockResolvedValue({
      id: "quote-2",
      projectId: "proj-2",
      subtotal: 350,
      total: 350,
      estimateMin: 332.5,
      estimateMax: 367.5,
      refinedEstimate: {
        tiers: {
          economy: NON_TIERED_REFINED_ESTIMATE,
          standard: NON_TIERED_REFINED_ESTIMATE,
          premium: premiumTier,
        },
        selectedTier: "premium",
      },
      project: {
        id: "proj-2",
        address: "789 Side St",
        draftData: {},
        user: { name: "Tenant User" },
        photos: [{ declaredModificationCodes: ["GRAB_BARS"] }],
      },
    });

    const result = await assembleEstimateInput("quote-2");

    expect(result.selectedTier).toBe("premium");
    expect(result.pricing.total).toBe(500);
  });

  it("marks missing fields as [Incomplete] and records them, never throwing", async () => {
    prisma.quote.findUnique.mockResolvedValue({
      id: "quote-3",
      projectId: "proj-3",
      subtotal: 0,
      total: 0,
      estimateMin: null,
      estimateMax: null,
      refinedEstimate: null,
      project: {
        id: "proj-3",
        address: null,
        draftData: {},
        user: { name: null },
        photos: [],
      },
    });

    const result = await assembleEstimateInput("quote-3");

    expect(result.clientName).toBe("[Incomplete]");
    expect(result.projectAddress).toBe("[Incomplete]");
    expect(result.modificationType).toBe("[Incomplete]");
    expect(result.incompleteFields).toEqual(
      expect.arrayContaining(["client name", "project address", "modification type"])
    );
  });

  it("falls back to manual-mode submission's modification type when no photos are declared", async () => {
    prisma.quote.findUnique.mockResolvedValue({
      id: "quote-4",
      projectId: "proj-4",
      subtotal: 0,
      total: 0,
      estimateMin: null,
      estimateMax: null,
      refinedEstimate: null,
      project: {
        id: "proj-4",
        address: "1 Nowhere Ave",
        draftData: {},
        user: { name: "Manual User" },
        photos: [],
        manualModeSubmission: { modificationType: "Custom ramp install" },
      },
    });

    const result = await assembleEstimateInput("quote-4");

    expect(result.modificationType).toBe("Custom ramp install");
  });

  it("uses the override's pricing, collapses tiering, and synthesizes real line items when overridden", async () => {
    prisma.quote.findUnique.mockResolvedValue({
      id: "quote-5",
      projectId: "proj-5",
      subtotal: 350,
      total: 350,
      estimateMin: 332.5,
      estimateMax: 367.5,
      refinedEstimate: {
        tiers: {
          economy: NON_TIERED_REFINED_ESTIMATE,
          standard: NON_TIERED_REFINED_ESTIMATE,
          premium: NON_TIERED_REFINED_ESTIMATE,
        },
        selectedTier: "premium",
      },
      override: {
        subtotal: 400,
        total: 480,
        lineItems: [{ description: "Grab bar install (adjusted)", quantity: 2, materialTotal: 100, laborTotal: 300 }],
      },
      project: {
        id: "proj-5",
        address: "10 Override Ln",
        draftData: {},
        user: { name: "Override User" },
        photos: [{ declaredModificationCodes: ["GRAB_BARS"] }],
      },
    });

    const result = await assembleEstimateInput("quote-5");

    expect(result.selectedTier).toBeNull();
    expect(result.wasOverridden).toBe(true);
    expect(result.pricing).toMatchObject({
      selectedTier: null,
      subtotal: 400,
      total: 480,
      laborTotal: 300,
      markupTotal: 0,
      estimateMin: 480,
      estimateMax: 480,
    });
    expect(result.pricing.lineItems).toEqual([
      expect.objectContaining({
        description: "Grab bar install (adjusted)",
        quantity: 2,
        materialTotal: 100,
        laborTotal: 300,
        markupTotal: 0,
        lineTotal: 400,
      }),
    ]);
  });

  it("throws when the quote does not exist", async () => {
    prisma.quote.findUnique.mockResolvedValue(null);

    await expect(assembleEstimateInput("missing")).rejects.toThrow("Quote not found");
  });
});
