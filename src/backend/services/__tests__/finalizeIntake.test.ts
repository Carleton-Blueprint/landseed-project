import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { generateQuote } from "@/backend/services/quote";
import { markEstimateReadyForReview } from "@/backend/services/estimateReadyTransition";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/services/quote", () => ({
  generateQuote: jest.fn(),
}));

jest.mock("@/backend/services/estimateReadyTransition", () => ({
  markEstimateReadyForReview: jest.fn(),
}));

const mockedProjectUpdateMany = jest.fn();

const serpLineItem = {
  description: "Mock item",
  quantity: 1,
  pricingQuery: "Mock item",
  pricingSource: "store",
  pricingLink: null,
  materialUnitCost: 100,
  materialTotal: 100,
  laborHours: 1,
  laborRate: 80,
  laborTotal: 80,
  markupPercentage: 0.15,
  markupTotal: 27,
  lineTotal: 207,
};

const partialLineItem = {
  ...serpLineItem,
  pricingSource: null,
};

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
    quote: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: { project: { updateMany: jest.Mock } }) => unknown) =>
      callback({ project: { updateMany: mockedProjectUpdateMany } })
    ),
  },
}));

const { finalizeIntake } = require("../finalizeIntake") as typeof import("../finalizeIntake");

describe("finalizeIntake", () => {
  const mockedPrisma = prisma as unknown as {
    project: {
      findUnique: jest.Mock;
    };
    quote: {
      findFirst: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;
  const mockedGenerateQuote = generateQuote as jest.MockedFunction<typeof generateQuote>;
  const mockedMarkEstimateReady =
    markEstimateReadyForReview as jest.MockedFunction<typeof markEstimateReadyForReview>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedProjectUpdateMany.mockReset();
  });

  it("returns an existing quote range for an already finalized project", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-2",
      status: "submitted",
      draftData: null,
      quotes: [
        {
          id: "quote-1",
          estimateMin: { toString: () => "1000.00" },
          estimateMax: { toString: () => "1500.00" },
          generatedAt: new Date("2026-06-15T10:00:00.000Z"),
          refinedEstimate: {
            lineItems: [serpLineItem],
          },
        },
      ],
    });

    const result = await finalizeIntake({ projectId: "proj-2" });

    expect(result).toEqual({
      ok: true,
      projectId: "proj-2",
      status: "already_finalized",
      message: "Project is already finalized.",
      quoteId: "quote-1",
      range: {
        min: 1000,
        max: 1500,
        source: "serp_api",
        generatedAt: "2026-06-15T10:00:00.000Z",
      },
    });

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("transitions draft project, generates a quote, and promotes estimate-ready", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-3",
      status: "draft",
      draftData: {
        modificationItems: ["Grab bars"],
      },
      quotes: [],
    });

    mockedProjectUpdateMany.mockResolvedValue({ count: 1 });
    mockedGenerateQuote.mockResolvedValue({
      quoteId: "quote-new",
      subtotal: 2100,
      total: 2450,
      pricingMatrixVersion: 3,
      eligibilityAssessmentId: undefined,
      estimateMin: 2327.5,
      estimateMax: 2572.5,
      pricingSource: "serp_api",
      refinedEstimate: {
        lineItems: [serpLineItem],
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
      triggerSource: "legacy-quote-generation",
      notificationIdempotencyKey: "estimate-ready:quote-new",
      notified: true,
      notificationQueuedAt: "2026-06-15T10:05:00.000Z",
    });

    const result = await finalizeIntake({
      projectId: "proj-3",
      actorUserId: "user-3",
    });

    expect(result).toEqual({
      ok: true,
      projectId: "proj-3",
      status: "estimate_ready",
      quoteId: "quote-new",
      range: {
        min: 2327.5,
        max: 2572.5,
        source: "serp_api",
        generatedAt: expect.any(String),
      },
      message: "Intake finalized, preliminary quote generated, and estimate marked ready.",
    });

    expect(mockedGenerateQuote).toHaveBeenCalledWith({
      projectId: "proj-3",
      items: [
        {
          description: "Grab bars",
          quantity: 1,
          unitPrice: 150,
        },
      ],
    });
    expect(mockedMarkEstimateReady).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-3",
        quoteId: "quote-new",
        triggerSource: "legacy-quote-generation",
      })
    );
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "INTAKE_FINALIZED",
        projectId: "proj-3",
        outcome: "SUCCESS",
      })
    );
  });

  it("marks source as serp_api_partial when any line item lacks a pricing source", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-4",
      status: "draft",
      draftData: {
        modificationItems: ["Walk-in shower"],
      },
      quotes: [],
    });

    mockedProjectUpdateMany.mockResolvedValue({ count: 1 });
    mockedGenerateQuote.mockResolvedValue({
      quoteId: "quote-partial",
      subtotal: 1000,
      total: 1150,
      pricingMatrixVersion: 3,
      eligibilityAssessmentId: undefined,
      estimateMin: 1092.5,
      estimateMax: 1207.5,
      pricingSource: "serp_api_partial",
      refinedEstimate: {
        lineItems: [partialLineItem],
        subtotal: 1000,
        laborTotal: 100,
        markupTotal: 50,
        total: 1150,
        estimateMin: 1092.5,
        estimateMax: 1207.5,
      },
    });
    mockedMarkEstimateReady.mockResolvedValue({
      projectId: "proj-4",
      quoteId: "quote-partial",
      projectStatus: "estimate_ready",
      triggerSource: "legacy-quote-generation",
      notificationIdempotencyKey: "estimate-ready:quote-partial",
      notified: true,
      notificationQueuedAt: "2026-06-15T10:05:00.000Z",
    });

    const result = await finalizeIntake({ projectId: "proj-4" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.range?.source).toBe("serp_api_partial");
    }
  });

  it("keeps project submitted when quote generation fails", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-5",
      status: "draft",
      draftData: {
        modificationItems: ["Grab bars"],
      },
      quotes: [],
    });

    mockedProjectUpdateMany.mockResolvedValue({ count: 1 });
    mockedGenerateQuote.mockRejectedValue(new Error("pricing failed"));

    const result = await finalizeIntake({
      projectId: "proj-5",
      actorUserId: "user-5",
    });

    expect(result).toEqual({
      ok: true,
      projectId: "proj-5",
      status: "submitted",
      message: "Intake finalized successfully. Preliminary quote generation is pending.",
    });

    expect(mockedMarkEstimateReady).not.toHaveBeenCalled();
  });
});
