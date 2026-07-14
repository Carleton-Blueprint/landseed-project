import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { estimateGenerationQueue } from "@/backend/queue";
import {
  buildEstimateGenerationJobId,
  getEstimateGenerationDelayMs,
} from "@/backend/services/estimateGeneration";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  estimateGenerationQueue: {
    add: jest.fn(),
  },
}));

jest.mock("@/backend/services/estimateGeneration", () => ({
  buildEstimateGenerationJobId: jest.fn((projectId: string) => `estimate-generation:${projectId}`),
  getEstimateGenerationDelayMs: jest.fn(() => 15 * 60 * 1000),
}));

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

const mockedProjectUpdateMany = jest.fn();

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
  const mockedQueueAdd = estimateGenerationQueue.add as jest.MockedFunction<
    typeof estimateGenerationQueue.add
  >;

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
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("transitions draft project to submitted and schedules delayed estimate generation", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-3",
      status: "draft",
      draftData: {
        modificationItems: ["Grab bars"],
      },
      quotes: [],
    });

    mockedProjectUpdateMany.mockResolvedValue({ count: 1 });

    const result = await finalizeIntake({
      projectId: "proj-3",
      actorUserId: "user-3",
    });

    expect(result).toEqual({
      ok: true,
      projectId: "proj-3",
      status: "submitted",
      message: "Intake finalized. Preliminary quote generation is scheduled.",
    });

    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "INTAKE_FINALIZED",
        projectId: "proj-3",
        outcome: "SUCCESS",
      })
    );

    expect(buildEstimateGenerationJobId).toHaveBeenCalledWith("proj-3");
    expect(getEstimateGenerationDelayMs).toHaveBeenCalled();
    expect(mockedQueueAdd).toHaveBeenCalledWith(
      "generate-estimate",
      { projectId: "proj-3", actorUserId: "user-3" },
      expect.objectContaining({
        jobId: "estimate-generation:proj-3",
        delay: 15 * 60 * 1000,
      })
    );
  });

  it("returns already_finalized when another request wins the draft-to-submitted race", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-5",
      status: "draft",
      draftData: {
        modificationItems: ["Grab bars"],
      },
      quotes: [],
    });

    mockedProjectUpdateMany.mockResolvedValue({ count: 0 });
    mockedPrisma.quote.findFirst.mockResolvedValue(null);

    const result = await finalizeIntake({
      projectId: "proj-5",
      actorUserId: "user-5",
    });

    expect(result).toEqual({
      ok: true,
      projectId: "proj-5",
      status: "already_finalized",
      message: "Project was finalized by another request.",
    });

    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("returns PROJECT_NOT_FOUND when the project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    const result = await finalizeIntake({ projectId: "missing" });

    expect(result).toEqual({
      ok: false,
      code: "PROJECT_NOT_FOUND",
      projectId: "missing",
      status: "unknown",
      message: "Project not found.",
    });

    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });
});
