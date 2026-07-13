/**
 * FR-4.10 phase 3: composed integration coverage across finalizeIntake (phase 1,
 * schedules the delayed estimate-generation job), the pre-estimate override API
 * (phase 2), and the worker's processScheduledEstimateGeneration (phase 1).
 *
 * These mock prisma/BullMQ rather than requiring live Redis/Postgres (see
 * src/backend/eligibility/__tests__/manualReviewIntegration.test.ts for the
 * live-infra style used elsewhere in this repo). Instead of running a real
 * BullMQ worker, each scenario calls processScheduledEstimateGeneration
 * directly to stand in for "the delayed job fires," which is enough to prove
 * the data contract between the three pieces: the worker always reads
 * modificationItems fresh at execution time, so whatever the override wrote
 * last is what gets quoted.
 */
import { prisma } from "lib/prisma";
import { generateQuote } from "@/backend/services/quote";
import { markEstimateReadyForReview } from "@/backend/services/estimateReadyTransition";
import { estimateGenerationQueue } from "@/backend/queue";
import { finalizeIntake } from "@/backend/services/finalizeIntake";
import { processScheduledEstimateGeneration } from "@/backend/services/estimateGeneration";
import { overridePreEstimateModifications } from "@/backend/services/modificationOverride";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/eligibility/triggers", () => ({
  triggerEvaluationAfterDraftUpdate: jest.fn(),
}));

jest.mock("@/backend/services/quote", () => ({
  generateQuote: jest.fn(),
}));

jest.mock("@/backend/services/estimateReadyTransition", () => ({
  markEstimateReadyForReview: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  estimateGenerationQueue: {
    add: jest.fn(),
  },
}));

const mockedProjectUpdateManyInTransaction = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    quote: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: { project: { updateMany: jest.Mock } }) => unknown) =>
      callback({ project: { updateMany: mockedProjectUpdateManyInTransaction } })
    ),
  },
}));

function quoteResult(quoteId: string) {
  return {
    quoteId,
    subtotal: 1000,
    total: 1150,
    eligibilityAssessmentId: undefined,
    estimateMin: 1092.5,
    estimateMax: 1207.5,
    pricingSource: "serp_api" as const,
    refinedEstimate: {
      lineItems: [],
      subtotal: 1000,
      laborTotal: 100,
      markupTotal: 50,
      total: 1150,
      estimateMin: 1092.5,
      estimateMax: 1207.5,
    },
  };
}

describe("FR-4.10: delayed estimate generation + pre-estimate override integration", () => {
  const mockedPrisma = prisma as unknown as {
    project: { findUnique: jest.Mock; updateMany: jest.Mock };
    quote: { findFirst: jest.Mock };
  };
  const mockedQueueAdd = estimateGenerationQueue.add as jest.MockedFunction<typeof estimateGenerationQueue.add>;
  const mockedGenerateQuote = generateQuote as jest.MockedFunction<typeof generateQuote>;
  const mockedMarkEstimateReady = markEstimateReadyForReview as jest.MockedFunction<
    typeof markEstimateReadyForReview
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedProjectUpdateManyInTransaction.mockReset();
  });

  it("uses the overridden modificationItems when the worker runs after an in-window override", async () => {
    // 1. Client submits intake; finalizeIntake transitions draft -> submitted
    //    and schedules the delayed job instead of quoting inline.
    mockedPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-int-1",
      status: "draft",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [],
    });
    mockedProjectUpdateManyInTransaction.mockResolvedValue({ count: 1 });

    const finalizeResult = await finalizeIntake({ projectId: "proj-int-1", actorUserId: "user-1" });

    expect(finalizeResult).toMatchObject({ ok: true, status: "submitted" });
    expect(mockedQueueAdd).toHaveBeenCalledTimes(1);

    // 2. Before the delayed job fires, an admin overrides modification scope.
    mockedPrisma.project.findUnique
      .mockResolvedValueOnce({
        id: "proj-int-1",
        status: "submitted",
        draftData: { modificationItems: ["Grab bars"] },
        quotes: [],
      })
      .mockResolvedValueOnce({
        id: "proj-int-1",
        status: "submitted",
        draftData: { modificationItems: ["Walk-in shower"] },
      });
    mockedPrisma.project.updateMany.mockResolvedValueOnce({ count: 1 });

    const overrideResult = await overridePreEstimateModifications({
      projectId: "proj-int-1",
      actorUserId: "admin-1",
      modificationItems: ["Walk-in shower"],
    });

    expect(overrideResult.modificationItems).toEqual(["Walk-in shower"]);

    // 3. The delayed job now fires and must read the overridden value, not
    //    the value that was present at submit time.
    mockedPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-int-1",
      status: "submitted",
      draftData: { modificationItems: ["Walk-in shower"] },
      quotes: [],
    });
    mockedGenerateQuote.mockResolvedValueOnce(quoteResult("quote-int-1"));
    mockedMarkEstimateReady.mockResolvedValueOnce({
      projectId: "proj-int-1",
      quoteId: "quote-int-1",
      projectStatus: "estimate_ready",
      triggerSource: "delayed-estimate-generation",
      notificationIdempotencyKey: "estimate-ready:quote-int-1",
      notified: true,
      notificationQueuedAt: "2026-06-15T10:05:00.000Z",
    });

    const workerResult = await processScheduledEstimateGeneration({ projectId: "proj-int-1" });

    expect(workerResult).toEqual({ projectId: "proj-int-1", status: "generated", quoteId: "quote-int-1" });
    expect(mockedGenerateQuote).toHaveBeenCalledWith({
      projectId: "proj-int-1",
      items: [{ description: "Walk-in shower", quantity: 1, unitPrice: 150 }],
      modificationCodes: ["WALK_IN_SHOWER"],
    });
  });

  it("uses the original intake modificationItems when no override happens before the worker runs", async () => {
    mockedPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-int-2",
      status: "draft",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [],
    });
    mockedProjectUpdateManyInTransaction.mockResolvedValue({ count: 1 });

    await finalizeIntake({ projectId: "proj-int-2", actorUserId: "user-2" });
    expect(mockedQueueAdd).toHaveBeenCalledTimes(1);

    mockedPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-int-2",
      status: "submitted",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [],
    });
    mockedGenerateQuote.mockResolvedValueOnce(quoteResult("quote-int-2"));
    mockedMarkEstimateReady.mockResolvedValueOnce({
      projectId: "proj-int-2",
      quoteId: "quote-int-2",
      projectStatus: "estimate_ready",
      triggerSource: "delayed-estimate-generation",
      notificationIdempotencyKey: "estimate-ready:quote-int-2",
      notified: true,
      notificationQueuedAt: "2026-06-15T10:05:00.000Z",
    });

    const workerResult = await processScheduledEstimateGeneration({ projectId: "proj-int-2" });

    expect(workerResult).toEqual({ projectId: "proj-int-2", status: "generated", quoteId: "quote-int-2" });
    expect(mockedGenerateQuote).toHaveBeenCalledWith({
      projectId: "proj-int-2",
      items: [{ description: "Grab bars", quantity: 1, unitPrice: 150 }],
      modificationCodes: ["GRAB_BARS"],
    });
  });

  it("rejects the override with the FR-4.3 redirect once the worker has already generated a quote", async () => {
    // The delayed job fires first and generates a quote.
    mockedPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-int-3",
      status: "submitted",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [],
    });
    mockedGenerateQuote.mockResolvedValueOnce(quoteResult("quote-int-3"));
    mockedMarkEstimateReady.mockResolvedValueOnce({
      projectId: "proj-int-3",
      quoteId: "quote-int-3",
      projectStatus: "estimate_ready",
      triggerSource: "delayed-estimate-generation",
      notificationIdempotencyKey: "estimate-ready:quote-int-3",
      notified: true,
      notificationQueuedAt: "2026-06-15T10:05:00.000Z",
    });

    const workerResult = await processScheduledEstimateGeneration({ projectId: "proj-int-3" });
    expect(workerResult.status).toBe("generated");

    // An admin's override request arrives moments later, after the quote
    // already exists -> must be rejected with the FR-4.3 redirect, not applied.
    mockedPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-int-3",
      status: "estimate_ready",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [{ id: "quote-int-3" }],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-int-3",
        actorUserId: "admin-1",
        modificationItems: ["Walk-in shower"],
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_ALREADY_GENERATED",
      statusCode: 409,
      redirectTo: "post_estimate_override",
    });

    expect(mockedPrisma.project.updateMany).not.toHaveBeenCalled();
  });
});
