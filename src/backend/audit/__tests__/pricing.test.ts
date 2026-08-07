import { describe, expect, it, jest, beforeEach } from "@jest/globals";

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

const { logAuditEventNonBlocking } = require("@/backend/audit/log") as {
  logAuditEventNonBlocking: jest.Mock;
};

const {
  normalizePricingDecisionAuditMetadata,
  logPricingDecisionAuditNonBlocking,
} = require("../pricing") as typeof import("../pricing");

describe("normalizePricingDecisionAuditMetadata", () => {
  it("returns null for non-object input", () => {
    expect(normalizePricingDecisionAuditMetadata(null)).toBeNull();
    expect(normalizePricingDecisionAuditMetadata(undefined)).toBeNull();
    expect(normalizePricingDecisionAuditMetadata("a string")).toBeNull();
    expect(normalizePricingDecisionAuditMetadata(42)).toBeNull();
    expect(normalizePricingDecisionAuditMetadata(true)).toBeNull();
  });

  it("returns null for an array input", () => {
    expect(normalizePricingDecisionAuditMetadata([1, 2, 3])).toBeNull();
  });

  it("returns null when `pricing` sub-object is missing", () => {
    expect(normalizePricingDecisionAuditMetadata({ foo: "bar" })).toBeNull();
  });

  it("returns null when `pricing` is not an object (malformed)", () => {
    expect(normalizePricingDecisionAuditMetadata({ pricing: "not-an-object" })).toBeNull();
    expect(normalizePricingDecisionAuditMetadata({ pricing: 123 })).toBeNull();
    expect(normalizePricingDecisionAuditMetadata({ pricing: null })).toBeNull();
    expect(normalizePricingDecisionAuditMetadata({ pricing: [1, 2] })).toBeNull();
  });

  it("defaults subtotal/total to 0 when not numbers", () => {
    const result = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: "100", total: null },
    });

    expect(result).not.toBeNull();
    expect(result!.pricing).toEqual({ subtotal: 0, total: 0 });
  });

  it("preserves numeric subtotal/total", () => {
    const result = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 150.5, total: 200 },
    });

    expect(result!.pricing).toEqual({ subtotal: 150.5, total: 200 });
  });

  it("defaults eligibilityAssessmentId to null when missing or non-string", () => {
    const missing = normalizePricingDecisionAuditMetadata({ pricing: { subtotal: 1, total: 2 } });
    expect(missing!.eligibilityAssessmentId).toBeNull();

    const nonString = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 1, total: 2 },
      eligibilityAssessmentId: 12345,
    });
    expect(nonString!.eligibilityAssessmentId).toBeNull();
  });

  it("preserves eligibilityAssessmentId when a string", () => {
    const result = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 1, total: 2 },
      eligibilityAssessmentId: "assessment-1",
    });
    expect(result!.eligibilityAssessmentId).toBe("assessment-1");
  });

  it("defaults externalSources to [] when missing or not an array", () => {
    const missing = normalizePricingDecisionAuditMetadata({ pricing: { subtotal: 1, total: 2 } });
    expect(missing!.externalSources).toEqual([]);
    expect(missing!.externalSourceCount).toBe(0);

    const nonArray = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 1, total: 2 },
      externalSources: "not-an-array",
    });
    expect(nonArray!.externalSources).toEqual([]);
  });

  it("preserves externalSources array and derives externalSourceCount when not explicitly given", () => {
    const sources = [
      { sourceType: "DISCOVERY_GRANT_SOURCE", sourceId: "s1" },
      { sourceType: "DISCOVERY_GRANT_SOURCE", sourceId: "s2" },
    ];
    const result = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 1, total: 2 },
      externalSources: sources,
    });
    expect(result!.externalSources).toEqual(sources);
    expect(result!.externalSourceCount).toBe(2);
  });

  it("uses explicit externalSourceCount when it is a number, even if it disagrees with array length", () => {
    const result = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 1, total: 2 },
      externalSources: [{ sourceType: "DISCOVERY_GRANT_SOURCE" }],
      externalSourceCount: 99,
    });
    expect(result!.externalSourceCount).toBe(99);
  });

  it("normalizes discoveryVersion and aiOutput to null when missing or malformed", () => {
    const result = normalizePricingDecisionAuditMetadata({ pricing: { subtotal: 1, total: 2 } });
    expect(result!.discoveryVersion).toBeNull();
    expect(result!.aiOutput).toBeNull();

    const malformed = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 1, total: 2 },
      discoveryVersion: "not-an-object",
      aiOutput: 42,
    });
    expect(malformed!.discoveryVersion).toBeNull();
    expect(malformed!.aiOutput).toBeNull();
  });

  it("preserves discoveryVersion and aiOutput when valid objects", () => {
    const discoveryVersion = { engineVersion: "v1", promptVersion: "v2" };
    const aiOutput = { provider: "OPENAI", overallDecision: "approved" };
    const result = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 1, total: 2 },
      discoveryVersion,
      aiOutput,
    });
    expect(result!.discoveryVersion).toEqual(discoveryVersion);
    expect(result!.aiOutput).toEqual(aiOutput);
  });

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

  it("round-trips a fallback line item's reason", () => {
    const normalized = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 500, total: 600 },
      fallbackLineItems: [
        { description: "Grab bars", query: "grab bars", fallbackUnitPrice: 153, reason: "implausible_tier_spread" },
      ],
    });

    expect(normalized?.fallbackLineItems).toEqual([
      { description: "Grab bars", query: "grab bars", fallbackUnitPrice: 153, reason: "implausible_tier_spread" },
    ]);
  });

  it("falls back to null/empty for missing or invalid provenance fields (pricingSource/fallbackLineItems/outputSource/isFallback)", () => {
    const normalized = normalizePricingDecisionAuditMetadata({
      pricing: { subtotal: 500, total: 600 },
    });

    expect(normalized?.pricingSource).toBeNull();
    expect(normalized?.fallbackLineItems).toEqual([]);
    expect(normalized?.outputSource).toBeNull();
    expect(normalized?.isFallback).toBe(false);
  });

  it("normalizes a fully valid, fully populated metadata object", () => {
    const input = {
      pricing: { subtotal: 100, total: 120 },
      eligibilityAssessmentId: "assessment-1",
      discoveryVersion: { engineVersion: "v1" },
      aiOutput: { provider: "HEURISTIC" },
      externalSources: [{ sourceType: "DISCOVERY_GRANT_SOURCE", sourceId: "s1" }],
      externalSourceCount: 1,
      pricingSource: "serp_api" as const,
      fallbackLineItems: [],
      outputSource: "LIVE" as const,
      isFallback: false,
    };
    const result = normalizePricingDecisionAuditMetadata(input);
    expect(result).toEqual(input);
  });
});

describe("logPricingDecisionAuditNonBlocking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs with empty externalSources and externalSourceCount 0 when none are provided", async () => {
    await logPricingDecisionAuditNonBlocking({
      projectId: "project-1",
      quoteId: "quote-1",
      subtotal: 100,
      total: 120,
      pricingSource: "serp_api",
    });

    expect(logAuditEventNonBlocking).toHaveBeenCalledTimes(1);
    const call = logAuditEventNonBlocking.mock.calls[0][0] as {
      metadata: { externalSources: unknown[]; externalSourceCount: number };
    };
    expect(call.metadata.externalSources).toEqual([]);
    expect(call.metadata.externalSourceCount).toBe(0);
  });

  it("passes through category/action/outcome/resource fields and pricing metadata", async () => {
    await logPricingDecisionAuditNonBlocking({
      projectId: "project-1",
      quoteId: "quote-1",
      actorUserId: "user-1",
      subtotal: 100,
      total: 120,
      eligibilityAssessmentId: "assessment-1",
      pricingSource: "serp_api",
    });

    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "MANUAL_CHANGE",
        action: "PRICING_DECISION_GENERATED",
        outcome: "SUCCESS",
        actorUserId: "user-1",
        projectId: "project-1",
        quoteId: "quote-1",
        resourceType: "Quote",
        resourceId: "quote-1",
        metadata: expect.objectContaining({
          pricing: { subtotal: 100, total: 120 },
          eligibilityAssessmentId: "assessment-1",
        }),
      })
    );
  });

  it("defaults actorUserId to null when not provided", async () => {
    await logPricingDecisionAuditNonBlocking({
      projectId: "project-1",
      quoteId: "quote-1",
      subtotal: 100,
      total: 120,
      pricingSource: "serp_api",
    });

    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null })
    );
  });

  it("dedupes externalSources by sourceType|sourceId|sourceUrl, keeping the first occurrence", async () => {
    await logPricingDecisionAuditNonBlocking({
      projectId: "project-1",
      quoteId: "quote-1",
      subtotal: 100,
      total: 120,
      pricingSource: "serp_api",
      externalSources: [
        { sourceType: "DISCOVERY_GRANT_SOURCE", sourceId: "s1", sourceUrl: "https://a.example", title: "first" },
        { sourceType: "DISCOVERY_GRANT_SOURCE", sourceId: "s1", sourceUrl: "https://a.example", title: "duplicate" },
        { sourceType: "DISCOVERY_GRANT_SOURCE", sourceId: "s2", sourceUrl: "https://a.example" },
        { sourceType: "DISCOVERY_GRANT_SOURCE", sourceId: "s1", sourceUrl: "https://b.example" },
      ],
    });

    const call = logAuditEventNonBlocking.mock.calls[0][0] as {
      metadata: {
        externalSources: Array<{ sourceId?: string; title?: string; sourceUrl?: string | null }>;
        externalSourceCount: number;
      };
    };

    expect(call.metadata.externalSources).toHaveLength(3);
    expect(call.metadata.externalSourceCount).toBe(3);
    // First occurrence of the s1|https://a.example key is kept, not the duplicate.
    expect(call.metadata.externalSources[0]).toEqual(
      expect.objectContaining({ sourceId: "s1", sourceUrl: "https://a.example", title: "first" })
    );
  });

  it("treats sources with missing sourceId/sourceUrl as sharing an empty-string dedupe key", async () => {
    await logPricingDecisionAuditNonBlocking({
      projectId: "project-1",
      quoteId: "quote-1",
      subtotal: 100,
      total: 120,
      pricingSource: "serp_api",
      externalSources: [
        { sourceType: "DISCOVERY_GRANT_SOURCE" },
        { sourceType: "DISCOVERY_GRANT_SOURCE" },
      ],
    });

    const call = logAuditEventNonBlocking.mock.calls[0][0] as {
      metadata: { externalSources: unknown[] };
    };
    expect(call.metadata.externalSources).toHaveLength(1);
  });

  it("includes pricingSource and fallbackLineItems in the audit event metadata, and derives outputSource/isFallback", async () => {
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

    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PRICING_DECISION_GENERATED",
        metadata: expect.objectContaining({
          pricingSource: "serp_api_partial",
          fallbackLineItems: [
            { description: "Grab bars", query: "grab bars", fallbackUnitPrice: 150 },
          ],
          outputSource: "MOCK",
          isFallback: true,
        }),
      })
    );
  });

  it("carries a fallback line item's reason through to the audit event metadata", async () => {
    await logPricingDecisionAuditNonBlocking({
      projectId: "project-1",
      quoteId: "quote-1",
      subtotal: 500,
      total: 600,
      pricingSource: "serp_api_partial",
      fallbackLineItems: [
        { description: "Grab bars", query: "grab bars", fallbackUnitPrice: 153, reason: "implausible_tier_spread" },
      ],
    });

    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          fallbackLineItems: [
            { description: "Grab bars", query: "grab bars", fallbackUnitPrice: 153, reason: "implausible_tier_spread" },
          ],
        }),
      })
    );
  });

  it("defaults fallbackLineItems to an empty array and derives a LIVE outputSource when pricingSource is serp_api", async () => {
    await logPricingDecisionAuditNonBlocking({
      projectId: "project-1",
      quoteId: "quote-1",
      subtotal: 500,
      total: 600,
      pricingSource: "serp_api",
    });

    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          pricingSource: "serp_api",
          fallbackLineItems: [],
          outputSource: "LIVE",
          isFallback: false,
        }),
      })
    );
  });
});
