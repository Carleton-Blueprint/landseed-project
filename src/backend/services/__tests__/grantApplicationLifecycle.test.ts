import { GrantApplicationStatus } from "@prisma/client";
import {
  GrantLifecycleTransitionError,
  isValidGrantApplicationStatus,
  transitionGrantApplicationStatus,
} from "../grantApplicationLifecycle";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { attachGrantMatchSummaryToBuilderTrendTransfer } from "@/backend/integrations/buildertrend";
import { prisma } from "lib/prisma";

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn(),
}));

jest.mock("@/backend/integrations/buildertrend", () => ({
  attachGrantMatchSummaryToBuilderTrendTransfer: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

describe("grantApplicationLifecycle", () => {
  const mockedHasProjectAccess = hasProjectAccess as jest.MockedFunction<typeof hasProjectAccess>;
  const mockedAttachGrantMatchSummary = attachGrantMatchSummaryToBuilderTrendTransfer as jest.Mock;
  const mockedPrisma = prisma as unknown as {
    project: {
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAttachGrantMatchSummary.mockResolvedValue({ attached: false, transferId: null });
  });

  it("validates known status values", () => {
    expect(isValidGrantApplicationStatus("DRAFT")).toBe(true);
    expect(isValidGrantApplicationStatus("APPROVED")).toBe(true);
    expect(isValidGrantApplicationStatus("INVALID")).toBe(false);
    expect(isValidGrantApplicationStatus(123)).toBe(false);
  });

  it("rejects when user has no editor access", async () => {
    mockedHasProjectAccess.mockResolvedValue(false);

    await expect(
      transitionGrantApplicationStatus({
        projectId: "proj-1",
        actorUserId: "user-1",
        toStatus: GrantApplicationStatus.SUBMITTED,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });

  it("rejects invalid transition matrix path", async () => {
    mockedHasProjectAccess.mockResolvedValue(true);
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      grantApplicationStatus: GrantApplicationStatus.DRAFT,
    });

    await expect(
      transitionGrantApplicationStatus({
        projectId: "proj-1",
        actorUserId: "user-1",
        toStatus: GrantApplicationStatus.APPROVED,
      })
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      statusCode: 422,
    });
  });

  it("requires a reason when transitioning to rejected", async () => {
    mockedHasProjectAccess.mockResolvedValue(true);
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      grantApplicationStatus: GrantApplicationStatus.SUBMITTED,
    });

    await expect(
      transitionGrantApplicationStatus({
        projectId: "proj-1",
        actorUserId: "user-1",
        toStatus: GrantApplicationStatus.REJECTED,
      })
    ).rejects.toMatchObject({
      code: "INVALID_REASON",
      statusCode: 400,
    });
  });

  it("returns transition payload on valid transition", async () => {
    mockedHasProjectAccess.mockResolvedValue(true);
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      grantApplicationStatus: GrantApplicationStatus.DRAFT,
    });

    const changedAt = new Date("2026-04-13T12:00:00.000Z");
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        project: {
          update: jest.fn().mockResolvedValue({}),
        },
        grantApplicationStatusHistory: {
          create: jest.fn().mockResolvedValue({
            id: "history-1",
            changedAt,
          }),
        },
      };
      return callback(tx);
    });

    const result = await transitionGrantApplicationStatus({
      projectId: "proj-1",
      actorUserId: "user-1",
      toStatus: GrantApplicationStatus.SUBMITTED,
      metadata: { source: "test" },
    });

    expect(result).toEqual({
      projectId: "proj-1",
      fromStatus: GrantApplicationStatus.DRAFT,
      toStatus: GrantApplicationStatus.SUBMITTED,
      changedAt,
      changedByUserId: "user-1",
      historyId: "history-1",
    });
    expect(mockedAttachGrantMatchSummary).not.toHaveBeenCalled();
  });

  it("attaches the grant match summary to BuilderTrend when transitioning to APPROVED", async () => {
    mockedHasProjectAccess.mockResolvedValue(true);
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      grantApplicationStatus: GrantApplicationStatus.UNDER_REVIEW,
    });

    const changedAt = new Date("2026-04-13T12:00:00.000Z");
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        project: { update: jest.fn().mockResolvedValue({}) },
        grantApplicationStatusHistory: {
          create: jest.fn().mockResolvedValue({ id: "history-2", changedAt }),
        },
      };
      return callback(tx);
    });

    await transitionGrantApplicationStatus({
      projectId: "proj-1",
      actorUserId: "user-1",
      toStatus: GrantApplicationStatus.APPROVED,
    });

    expect(mockedAttachGrantMatchSummary).toHaveBeenCalledWith("proj-1", "user-1");
  });

  it("does not fail the approval when the BuilderTrend attachment call rejects", async () => {
    mockedHasProjectAccess.mockResolvedValue(true);
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      grantApplicationStatus: GrantApplicationStatus.UNDER_REVIEW,
    });
    mockedAttachGrantMatchSummary.mockRejectedValue(new Error("BuilderTrend transfer lookup failed"));

    const changedAt = new Date("2026-04-13T12:00:00.000Z");
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        project: { update: jest.fn().mockResolvedValue({}) },
        grantApplicationStatusHistory: {
          create: jest.fn().mockResolvedValue({ id: "history-3", changedAt }),
        },
      };
      return callback(tx);
    });

    await expect(
      transitionGrantApplicationStatus({
        projectId: "proj-1",
        actorUserId: "user-1",
        toStatus: GrantApplicationStatus.APPROVED,
      })
    ).resolves.toMatchObject({ toStatus: GrantApplicationStatus.APPROVED });
  });

  it("exposes structured lifecycle errors", () => {
    const error = new GrantLifecycleTransitionError("x", 400, "NO_OP_TRANSITION");
    expect(error.code).toBe("NO_OP_TRANSITION");
    expect(error.statusCode).toBe(400);
  });
});
