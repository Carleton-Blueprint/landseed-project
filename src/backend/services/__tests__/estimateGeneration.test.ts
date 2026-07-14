import { prisma } from "lib/prisma";
import { generateQuote } from "@/backend/services/quote";
import { markEstimateReadyForReview } from "@/backend/services/estimateReadyTransition";
import { queueEligibilityEvaluation } from "@/backend/eligibility/triggers";

jest.mock("@/backend/services/quote", () => ({
  generateQuote: jest.fn(),
}));

jest.mock("@/backend/services/estimateReadyTransition", () => ({
  markEstimateReadyForReview: jest.fn(),
}));

jest.mock("@/backend/eligibility/triggers", () => ({
  queueEligibilityEvaluation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
  },
}));

const {
  getEstimateGenerationDelayMinutes,
  getEstimateGenerationDelayMs,
  buildEstimateGenerationJobId,
  buildQuoteItems,
  processScheduledEstimateGeneration,
  ESTIMATE_GENERATION_DELAY_MINUTES_ENV,
  DEFAULT_ESTIMATE_GENERATION_DELAY_MINUTES,
  MAX_ESTIMATE_GENERATION_DELAY_MINUTES,
} = require("../estimateGeneration") as typeof import("../estimateGeneration");

describe("estimateGeneration delay config", () => {
  const originalEnv = process.env[ESTIMATE_GENERATION_DELAY_MINUTES_ENV];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ESTIMATE_GENERATION_DELAY_MINUTES_ENV];
    } else {
      process.env[ESTIMATE_GENERATION_DELAY_MINUTES_ENV] = originalEnv;
    }
  });

  it("defaults to 15 minutes when unset", () => {
    delete process.env[ESTIMATE_GENERATION_DELAY_MINUTES_ENV];
    expect(getEstimateGenerationDelayMinutes()).toBe(DEFAULT_ESTIMATE_GENERATION_DELAY_MINUTES);
  });

  it("falls back to default when unparseable", () => {
    process.env[ESTIMATE_GENERATION_DELAY_MINUTES_ENV] = "not-a-number";
    expect(getEstimateGenerationDelayMinutes()).toBe(DEFAULT_ESTIMATE_GENERATION_DELAY_MINUTES);
  });

  it("falls back to default when zero or negative", () => {
    process.env[ESTIMATE_GENERATION_DELAY_MINUTES_ENV] = "0";
    expect(getEstimateGenerationDelayMinutes()).toBe(DEFAULT_ESTIMATE_GENERATION_DELAY_MINUTES);
  });

  it("respects a valid configured value", () => {
    process.env[ESTIMATE_GENERATION_DELAY_MINUTES_ENV] = "30";
    expect(getEstimateGenerationDelayMinutes()).toBe(30);
    expect(getEstimateGenerationDelayMs()).toBe(30 * 60 * 1000);
  });

  it("caps at 24 hours", () => {
    process.env[ESTIMATE_GENERATION_DELAY_MINUTES_ENV] = "999999";
    expect(getEstimateGenerationDelayMinutes()).toBe(MAX_ESTIMATE_GENERATION_DELAY_MINUTES);
  });

  it("builds a stable per-project job id", () => {
    expect(buildEstimateGenerationJobId("proj-1")).toBe("estimate-generation-proj-1");
  });
});

describe("buildQuoteItems", () => {
  it("falls back to a default line item when draftData has no modificationItems", () => {
    expect(buildQuoteItems(null)).toEqual([
      { description: "Home modifications (initial intake estimate)", quantity: 1, unitPrice: 150 },
    ]);
  });

  it("maps modificationItems into quote items", () => {
    expect(buildQuoteItems({ modificationItems: ["Grab bars", "Ramp"] })).toEqual([
      { description: "Grab bars", quantity: 1, unitPrice: 150 },
      { description: "Ramp", quantity: 1, unitPrice: 150 },
    ]);
  });
});

describe("processScheduledEstimateGeneration", () => {
  const mockedPrisma = prisma as unknown as {
    project: { findUnique: jest.Mock };
  };
  const mockedGenerateQuote = generateQuote as jest.MockedFunction<typeof generateQuote>;
  const mockedMarkEstimateReady = markEstimateReadyForReview as jest.MockedFunction<
    typeof markEstimateReadyForReview
  >;
  const mockedQueueEligibility = queueEligibilityEvaluation as jest.MockedFunction<
    typeof queueEligibilityEvaluation
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedQueueEligibility.mockResolvedValue(undefined);
  });

  it("skips generation when a quote already exists (idempotency)", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: "submitted",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [{ id: "quote-existing" }],
    });

    const result = await processScheduledEstimateGeneration({ projectId: "proj-1" });

    expect(result).toEqual({
      projectId: "proj-1",
      status: "skipped_quote_exists",
      quoteId: "quote-existing",
    });
    expect(mockedGenerateQuote).not.toHaveBeenCalled();
    expect(mockedMarkEstimateReady).not.toHaveBeenCalled();
  });

  it("skips generation when the project can no longer be found", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    const result = await processScheduledEstimateGeneration({ projectId: "missing" });

    expect(result).toEqual({ projectId: "missing", status: "skipped_project_not_submitted" });
    expect(mockedGenerateQuote).not.toHaveBeenCalled();
  });

  it("skips generation when the project is no longer submitted", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-2",
      status: "draft",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [],
    });

    const result = await processScheduledEstimateGeneration({ projectId: "proj-2" });

    expect(result).toEqual({ projectId: "proj-2", status: "skipped_project_not_submitted" });
    expect(mockedGenerateQuote).not.toHaveBeenCalled();
  });

  it("generates a quote from the current modificationItems and marks estimate ready", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-3",
      status: "submitted",
      draftData: { modificationItems: ["Walk-in shower"] },
      quotes: [],
    });

    mockedGenerateQuote.mockResolvedValue({
      quoteId: "quote-new",
      subtotal: 2100,
      total: 2450,
      eligibilityAssessmentId: undefined,
      estimateMin: 2327.5,
      estimateMax: 2572.5,
      pricingSource: "serp_api",
      refinedEstimate: {
        lineItems: [],
        subtotal: 2100,
        laborTotal: 600,
        markupTotal: 350,
        total: 2450,
        estimateMin: 2327.5,
        estimateMax: 2572.5,
      },
    });
    mockedMarkEstimateReady.mockResolvedValue({
      projectId: "proj-3",
      quoteId: "quote-new",
      projectStatus: "estimate_ready",
      triggerSource: "delayed-estimate-generation",
      notificationIdempotencyKey: "estimate-ready:quote-new",
      notified: true,
      notificationQueuedAt: "2026-06-15T10:05:00.000Z",
    });

    const result = await processScheduledEstimateGeneration({
      projectId: "proj-3",
      actorUserId: "user-3",
    });

    expect(result).toEqual({ projectId: "proj-3", status: "generated", quoteId: "quote-new" });
    expect(mockedGenerateQuote).toHaveBeenCalledWith({
      projectId: "proj-3",
      items: [{ description: "Walk-in shower", quantity: 1, unitPrice: 150 }],
      modificationCodes: ["WALK_IN_SHOWER"],
    });
    expect(mockedMarkEstimateReady).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-3",
        quoteId: "quote-new",
        triggerSource: "delayed-estimate-generation",
        actorUserId: "user-3",
      })
    );
    expect(mockedQueueEligibility).toHaveBeenCalledWith("proj-3");
  });

  it("still queues eligibility evaluation and rethrows when quote generation fails", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-4",
      status: "submitted",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [],
    });

    mockedGenerateQuote.mockRejectedValue(new Error("pricing failed"));

    await expect(
      processScheduledEstimateGeneration({ projectId: "proj-4", actorUserId: "user-4" })
    ).rejects.toThrow("pricing failed");

    expect(mockedMarkEstimateReady).not.toHaveBeenCalled();
    expect(mockedQueueEligibility).toHaveBeenCalledWith("proj-4");
  });
});
