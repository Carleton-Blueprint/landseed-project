import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { EligibilityDecision } from "@/backend/eligibility/types";
import type { DiscoveredGrant } from "@/backend/eligibility/discoverySearchProvider";
import { notifyEstimateUpdated } from "@/backend/services/estimateUpdatedNotification";
import {
  overridePostEstimateQuote,
  resolveEffectiveQuoteView,
  applyGrantOverridesToRawGrants,
  QuoteOverrideError,
} from "../quoteOverride";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/services/estimateUpdatedNotification", () => ({
  notifyEstimateUpdated: jest.fn(),
}));

const mockedTxProjectFindUnique = jest.fn();
const mockedTxPhotoUpdate = jest.fn();
const mockedTxPhotoFindMany = jest.fn();
const mockedTxQuoteOverrideUpsert = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
    eligibilityAssessment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        project: { findUnique: mockedTxProjectFindUnique },
        photo: { update: mockedTxPhotoUpdate, findMany: mockedTxPhotoFindMany },
        quoteOverride: { upsert: mockedTxQuoteOverrideUpsert },
      })
    ),
  },
}));

const basePricing = {
  lineItems: [{ description: "Grab bars", quantity: 2, materialTotal: 40, laborTotal: 60 }],
  subtotal: 100,
  total: 120,
};

const baseQuote = {
  id: "quote-1",
  subtotal: 90 as unknown,
  total: 110 as unknown,
  refinedEstimate: null,
  eligibilityAssessmentId: "assessment-1" as string | null,
  override: null,
};

describe("overridePostEstimateQuote", () => {
  const mockedPrisma = prisma as unknown as {
    project: { findUnique: jest.Mock };
    eligibilityAssessment: { findUnique: jest.Mock; findFirst: jest.Mock };
  };
  const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;
  const mockedNotify = notifyEstimateUpdated as jest.MockedFunction<typeof notifyEstimateUpdated>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedTxProjectFindUnique.mockReset();
    mockedTxPhotoUpdate.mockReset();
    mockedTxPhotoFindMany.mockReset();
    mockedTxQuoteOverrideUpsert.mockReset();
    mockedTxQuoteOverrideUpsert.mockResolvedValue({ id: "override-1", updatedAt: new Date("2026-08-27T00:00:00Z") });
    mockedNotify.mockResolvedValue({
      projectId: "proj-1",
      quoteId: "quote-1",
      notificationIdempotencyKey: "estimate-updated:override-1-1",
      notified: true,
    });
  });

  function mockProject(overrides: Partial<typeof baseQuote> = {}, photos = [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }]) {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      photos,
      quotes: [{ ...baseQuote, ...overrides }],
    });
    mockedPrisma.eligibilityAssessment.findUnique.mockResolvedValue({
      overallDecision: "MANUAL_REVIEW",
      discoveredGrants: [
        {
          grantId: "grant-ai-1",
          title: "AI Found Grant",
          scope: "PROVINCIAL",
          jurisdiction: "Ontario",
          sourceUrl: null,
          summary: "summary",
          decision: "ELIGIBLE",
          relevanceScore: 80,
          confidence: "HIGH",
          matchedCriteria: [],
          missingCriteria: [],
          rationale: "",
          estimatedFundingAmount: null,
        },
      ],
    });
    mockedTxProjectFindUnique.mockResolvedValue({ quotes: [{ id: "quote-1" }] });
    mockedTxPhotoFindMany.mockResolvedValue(photos);
  }

  const validInput = {
    projectId: "proj-1",
    actorUserId: "admin-1",
    photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
    pricing: basePricing,
    eligibilityDecision: "ELIGIBLE",
    grantChanges: {},
    reason: "Client requested a manual review of pricing",
  };

  it("throws MISSING_REASON when reason is blank", async () => {
    await expect(overridePostEstimateQuote({ ...validInput, reason: "   " })).rejects.toMatchObject({
      code: "MISSING_REASON",
      statusCode: 400,
    });
  });

  it("throws PROJECT_NOT_FOUND when the project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    await expect(overridePostEstimateQuote(validInput)).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("throws QUOTE_NOT_FOUND when the project has no quote yet", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      photos: [],
      quotes: [],
    });

    await expect(overridePostEstimateQuote(validInput)).rejects.toMatchObject({
      code: "QUOTE_NOT_FOUND",
      statusCode: 409,
    });
  });

  it("rejects invalid pricing (negative total)", async () => {
    mockProject();

    await expect(
      overridePostEstimateQuote({ ...validInput, pricing: { ...basePricing, total: -5 } })
    ).rejects.toMatchObject({ code: "INVALID_PRICING", statusCode: 400 });
  });

  it("rejects an unrecognized eligibilityDecision", async () => {
    mockProject();

    await expect(
      overridePostEstimateQuote({ ...validInput, eligibilityDecision: "MAYBE" })
    ).rejects.toMatchObject({ code: "INVALID_ELIGIBILITY_DECISION", statusCode: 400 });
  });

  it("rejects grantChanges.removedGrantIds referencing an unknown grant", async () => {
    mockProject();

    await expect(
      overridePostEstimateQuote({
        ...validInput,
        grantChanges: { removedGrantIds: ["does-not-exist"] },
      })
    ).rejects.toMatchObject({ code: "INVALID_GRANT_CHANGES", statusCode: 400 });
  });

  it("rejects an addedGrants entry missing required fields", async () => {
    mockProject();

    await expect(
      overridePostEstimateQuote({
        ...validInput,
        grantChanges: { addedGrants: [{ title: "", scope: "PROVINCIAL", jurisdiction: "ON", decision: "ELIGIBLE" }] },
      })
    ).rejects.toMatchObject({ code: "INVALID_GRANT_CHANGES", statusCode: 400 });
  });

  it("applies a valid override: updates photo tags, upserts QuoteOverride, writes one audit event, and reports totalChanged", async () => {
    mockProject();

    const result = await overridePostEstimateQuote({
      ...validInput,
      grantChanges: {
        removedGrantIds: ["grant-ai-1"],
        addedGrants: [{ title: "Manual Grant", scope: "MUNICIPAL", jurisdiction: "Toronto", decision: "ELIGIBLE" }],
      },
    });

    expect(mockedTxPhotoUpdate).toHaveBeenCalledWith({
      where: { id: "photo-1" },
      data: { declaredModificationCodes: ["GRAB_BARS"] },
    });
    expect(mockedTxQuoteOverrideUpsert).toHaveBeenCalledTimes(1);
    expect(mockedAudit).toHaveBeenCalledTimes(1);
    expect(mockedAudit.mock.calls[0][0]).toMatchObject({
      action: "QUOTE_POST_ESTIMATE_OVERRIDE",
      category: "MANUAL_CHANGE",
      quoteId: "quote-1",
    });

    expect(result.totalChanged).toBe(true); // 110 (prior) -> 120 (new)
    expect(result.effective.total).toBe(120);
    expect(result.effective.discoveredGrants).toHaveLength(1);
    expect(result.effective.discoveredGrants[0]).toMatchObject({ title: "Manual Grant", source: "admin_added" });

    expect(mockedNotify).toHaveBeenCalledTimes(1);
    expect(mockedNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        quoteId: "quote-1",
        overrideId: "override-1",
        previousTotal: 110,
        newTotal: 120,
      })
    );
  });

  it("falls back to the project's latest eligibility assessment when quote.eligibilityAssessmentId is unset", async () => {
    mockProject({ eligibilityAssessmentId: null });
    mockedPrisma.eligibilityAssessment.findUnique.mockResolvedValue(null);
    mockedPrisma.eligibilityAssessment.findFirst.mockResolvedValue({
      overallDecision: "MANUAL_REVIEW",
      discoveredGrants: [
        {
          grantId: "grant-ai-1",
          title: "AI Found Grant",
          scope: "PROVINCIAL",
          jurisdiction: "Ontario",
          sourceUrl: null,
          summary: "summary",
          decision: "ELIGIBLE",
          relevanceScore: 80,
          confidence: "HIGH",
          matchedCriteria: [],
          missingCriteria: [],
          rationale: "",
          estimatedFundingAmount: null,
        },
      ],
    });

    const result = await overridePostEstimateQuote({
      ...validInput,
      grantChanges: { decisionOverrides: [{ grantId: "grant-ai-1", decision: "INELIGIBLE" }] },
    });

    expect(mockedPrisma.eligibilityAssessment.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.eligibilityAssessment.findFirst).toHaveBeenCalledWith({
      where: { projectId: "proj-1", isLatest: true },
      select: { overallDecision: true, discoveredGrants: true },
    });
    expect(result.effective.discoveredGrants[0]).toMatchObject({ grantId: "grant-ai-1", decision: "INELIGIBLE" });
  });

  it("reports totalChanged false when the new total equals the prior effective total, and does not notify", async () => {
    mockProject();

    const result = await overridePostEstimateQuote({
      ...validInput,
      pricing: { ...basePricing, total: 110 },
    });

    expect(result.totalChanged).toBe(false);
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it("does not fail the override when notifyEstimateUpdated throws", async () => {
    mockProject();
    mockedNotify.mockRejectedValue(new Error("email provider down"));

    const result = await overridePostEstimateQuote(validInput);

    expect(result.totalChanged).toBe(true);
    expect(result.effective.total).toBe(120);
  });

  it("throws QUOTE_NOT_FOUND if a newer quote was generated between read and write (race)", async () => {
    mockProject();
    mockedTxProjectFindUnique.mockResolvedValue({ quotes: [{ id: "quote-2" }] });

    await expect(overridePostEstimateQuote(validInput)).rejects.toMatchObject({
      code: "QUOTE_NOT_FOUND",
      statusCode: 409,
    });
    expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
  });

  it("is an instance of QuoteOverrideError for known failures", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);
    await expect(overridePostEstimateQuote(validInput)).rejects.toBeInstanceOf(QuoteOverrideError);
  });
});

describe("resolveEffectiveQuoteView", () => {
  const assessment = {
    overallDecision: "MANUAL_REVIEW" as const,
    discoveredGrants: [
      {
        grantId: "grant-ai-1",
        title: "AI Found Grant",
        scope: "PROVINCIAL",
        jurisdiction: "Ontario",
        sourceUrl: null,
        summary: "summary",
        decision: "ELIGIBLE",
        relevanceScore: 80,
        confidence: "HIGH",
        matchedCriteria: [],
        missingCriteria: [],
        rationale: "",
        estimatedFundingAmount: null,
      },
      {
        grantId: "grant-ai-2",
        title: "Second AI Grant",
        scope: "NATIONAL",
        jurisdiction: "Canada",
        sourceUrl: null,
        summary: "summary 2",
        decision: "INELIGIBLE",
        relevanceScore: 10,
        confidence: "LOW",
        matchedCriteria: [],
        missingCriteria: [],
        rationale: "",
        estimatedFundingAmount: null,
      },
    ],
  };

  it("falls back to raw AI values when there is no override", () => {
    const view = resolveEffectiveQuoteView(
      { subtotal: 90, total: 110, refinedEstimate: { lineItems: [{ description: "x", quantity: 1, materialTotal: 10, laborTotal: 10 }] } },
      null,
      assessment,
      ["GRAB_BARS"]
    );

    expect(view.isOverridden).toBe(false);
    expect(view.total).toBe(110);
    expect(view.eligibilityDecision).toBe("MANUAL_REVIEW");
    expect(view.discoveredGrants).toHaveLength(2);
    expect(view.discoveredGrants.every((g) => g.source === "ai")).toBe(true);
  });

  it("applies removedGrantIds, decisionOverrides, and addedGrants on top of the AI list", () => {
    const view = resolveEffectiveQuoteView(
      { subtotal: 90, total: 110 },
      {
        subtotal: 100,
        total: 120,
        lineItems: [],
        modificationCodes: ["GRAB_BARS"],
        eligibilityDecision: "ELIGIBLE" as never,
        grantOverrides: {
          removedGrantIds: ["grant-ai-2"],
          decisionOverrides: [{ grantId: "grant-ai-1", decision: "INELIGIBLE" }],
          addedGrants: [
            { id: "manual-1", title: "Manual Grant", scope: "MUNICIPAL", jurisdiction: "Toronto", decision: "ELIGIBLE", note: null },
          ],
        },
      },
      assessment,
      ["GRAB_BARS"]
    );

    expect(view.isOverridden).toBe(true);
    expect(view.discoveredGrants).toHaveLength(2);
    const aiGrant = view.discoveredGrants.find((g) => g.grantId === "grant-ai-1");
    expect(aiGrant).toMatchObject({ decision: "INELIGIBLE", source: "ai" });
    expect(view.discoveredGrants.find((g) => g.grantId === "grant-ai-2")).toBeUndefined();
    const manualGrant = view.discoveredGrants.find((g) => g.grantId === "manual-1");
    expect(manualGrant).toMatchObject({ title: "Manual Grant", source: "admin_added" });
  });
});

describe("applyGrantOverridesToRawGrants", () => {
  const rawGrants: DiscoveredGrant[] = [
    {
      grantId: "grant-ai-1",
      title: "AI Found Grant",
      scope: "PROVINCIAL",
      jurisdiction: "Ontario",
      sourceUrl: "https://example.com",
      summary: "summary",
      decision: EligibilityDecision.ELIGIBLE,
      relevanceScore: 90,
      confidence: "HIGH",
      matchedCriteria: ["criterion a"],
      missingCriteria: [],
      rationale: "meets all criteria",
      estimatedFundingAmount: "5000",
    },
  ];

  it("returns the raw grants unchanged when there is no override", () => {
    expect(applyGrantOverridesToRawGrants(rawGrants, null)).toBe(rawGrants);
  });

  it("preserves AI-only fields (rationale, matchedCriteria, sourceUrl) while applying a decision override", () => {
    const result = applyGrantOverridesToRawGrants(rawGrants, {
      removedGrantIds: [],
      decisionOverrides: [{ grantId: "grant-ai-1", decision: "INELIGIBLE" }],
      addedGrants: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      decision: "INELIGIBLE",
      rationale: "meets all criteria",
      matchedCriteria: ["criterion a"],
      sourceUrl: "https://example.com",
    });
  });

  it("drops removed grants and fills safe placeholders for admin-added ones", () => {
    const result = applyGrantOverridesToRawGrants(rawGrants, {
      removedGrantIds: ["grant-ai-1"],
      decisionOverrides: [],
      addedGrants: [
        { id: "manual-1", title: "Manual Grant", scope: "MUNICIPAL", jurisdiction: "Toronto", decision: "ELIGIBLE", note: "Confirmed by phone" },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      grantId: "manual-1",
      title: "Manual Grant",
      decision: "ELIGIBLE",
      rationale: "Confirmed by phone",
      matchedCriteria: [],
      missingCriteria: [],
      sourceUrl: null,
    });
  });
});
