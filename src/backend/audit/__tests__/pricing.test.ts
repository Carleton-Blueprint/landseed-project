import { logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  logPricingDecisionAuditNonBlocking,
  normalizePricingDecisionAuditMetadata,
} from "../pricing";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn().mockResolvedValue(undefined),
}));

const mockedLogAuditEventNonBlocking = logAuditEventNonBlocking as jest.Mock;

describe("logPricingDecisionAuditNonBlocking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes pricingSource and fallbackLineItems in the audit event metadata", async () => {
    await logPricingDecisionAuditNonBlocking({
      projectId: "project-1",
      quoteId: "quote-1",
      subtotal: 500,
      total: 600,
      pricingSource: "serp_api_partial",
      fallbackLineItems: [
        { description: "Grab bars", query: "grab bars", fallbackUnitPrice: 150 },
      ],
    });

    expect(mockedLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PRICING_DECISION_GENERATED",
        metadata: expect.objectContaining({
          pricingSource: "serp_api_partial",
          fallbackLineItems: [
            { description: "Grab bars", query: "grab bars", fallbackUnitPrice: 150 },
          ],
        }),
      })
    );
  });

  it("defaults fallbackLineItems to an empty array when none are given", async () => {
    await logPricingDecisionAuditNonBlocking({
      projectId: "project-1",
      quoteId: "quote-1",
      subtotal: 500,
      total: 600,
      pricingSource: "serp_api",
    });

    expect(mockedLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ pricingSource: "serp_api", fallbackLineItems: [] }),
      })
    );
  });
});

describe("normalizePricingDecisionAuditMetadata", () => {
  it("round-trips pricingSource and fallbackLineItems from stored metadata", () => {
    const normalized = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 500, total: 600 },
      pricingSource: "serp_api_partial",
      fallbackLineItems: [{ description: "Grab bars", query: "grab bars", fallbackUnitPrice: 150 }],
    });

    expect(normalized?.pricingSource).toBe("serp_api_partial");
    expect(normalized?.fallbackLineItems).toEqual([
      { description: "Grab bars", query: "grab bars", fallbackUnitPrice: 150 },
    ]);
  });

  it("falls back to null/empty for missing or invalid provenance fields", () => {
    const normalized = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 500, total: 600 },
    });

    expect(normalized?.pricingSource).toBeNull();
    expect(normalized?.fallbackLineItems).toEqual([]);
  });
});
