import { ProjectStatus } from "@prisma/client";
import {
  ProjectStatusTransitionError,
  isValidProjectStatus,
  transitionProjectStatus,
} from "../projectStatusLifecycle";
import { requestManualFallbackExport } from "@/backend/services/manualFallbackExport";
import { prisma } from "lib/prisma";

jest.mock("@/backend/services/manualFallbackExport", () => ({
  requestManualFallbackExport: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

describe("projectStatusLifecycle", () => {
  const mockedRequestManualFallbackExport = requestManualFallbackExport as jest.Mock;
  const mockedPrisma = prisma as unknown as {
    project: {
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequestManualFallbackExport.mockResolvedValue({ exportRequestId: "export-1" });
  });

  it("validates known status values", () => {
    expect(isValidProjectStatus("DRAFT")).toBe(true);
    expect(isValidProjectStatus("APPROVED")).toBe(true);
    expect(isValidProjectStatus("INVALID")).toBe(false);
    expect(isValidProjectStatus(123)).toBe(false);
  });

  it("rejects when isAdmin is not true", async () => {
    await expect(
      transitionProjectStatus({
        projectId: "proj-1",
        actorUserId: "user-1",
        toStatus: ProjectStatus.APPROVED,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });

  it("rejects an admin flag of false the same as no admin flag at all", async () => {
    await expect(
      transitionProjectStatus({
        projectId: "proj-1",
        actorUserId: "user-1",
        toStatus: ProjectStatus.APPROVED,
        isAdmin: false,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });

  it("rejects invalid transition matrix path", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: ProjectStatus.SUBMITTED,
    });

    await expect(
      transitionProjectStatus({
        projectId: "proj-1",
        actorUserId: "admin-1",
        toStatus: ProjectStatus.APPROVED,
        isAdmin: true,
      })
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      statusCode: 422,
    });
  });

  it("requires a reason when transitioning to rejected", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: ProjectStatus.ESTIMATE_ACCEPTED,
    });

    await expect(
      transitionProjectStatus({
        projectId: "proj-1",
        actorUserId: "admin-1",
        toStatus: ProjectStatus.REJECTED,
        isAdmin: true,
      })
    ).rejects.toMatchObject({
      code: "INVALID_REASON",
      statusCode: 400,
    });
  });

  it("returns transition payload on valid transition", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: ProjectStatus.ESTIMATE_ACCEPTED,
    });

    const changedAt = new Date("2026-04-13T12:00:00.000Z");
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        project: {
          update: jest.fn().mockResolvedValue({}),
        },
        projectStatusHistory: {
          create: jest.fn().mockResolvedValue({
            id: "history-1",
            changedAt,
          }),
        },
      };
      return callback(tx);
    });

    const result = await transitionProjectStatus({
      projectId: "proj-1",
      actorUserId: "admin-1",
      toStatus: ProjectStatus.REJECTED,
      reason: "Ineligible after review",
      isAdmin: true,
      metadata: { source: "test" },
    });

    expect(result).toEqual({
      projectId: "proj-1",
      fromStatus: ProjectStatus.ESTIMATE_ACCEPTED,
      toStatus: ProjectStatus.REJECTED,
      changedAt,
      changedByUserId: "admin-1",
      historyId: "history-1",
    });
    expect(mockedRequestManualFallbackExport).not.toHaveBeenCalled();
  });

  it("requests the BuilderTrend export package when transitioning to APPROVED", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: ProjectStatus.ESTIMATE_ACCEPTED,
    });

    const changedAt = new Date("2026-04-13T12:00:00.000Z");
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        project: { update: jest.fn().mockResolvedValue({}) },
        projectStatusHistory: {
          create: jest.fn().mockResolvedValue({ id: "history-2", changedAt }),
        },
      };
      return callback(tx);
    });

    await transitionProjectStatus({
      projectId: "proj-1",
      actorUserId: "admin-1",
      toStatus: ProjectStatus.APPROVED,
      isAdmin: true,
    });

    expect(mockedRequestManualFallbackExport).toHaveBeenCalledWith({
      projectId: "proj-1",
      requestedByUserId: "admin-1",
    });
  });

  it("does not fail the approval when the export request rejects", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: ProjectStatus.ESTIMATE_ACCEPTED,
    });
    mockedRequestManualFallbackExport.mockRejectedValue(new Error("Export request failed"));

    const changedAt = new Date("2026-04-13T12:00:00.000Z");
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        project: { update: jest.fn().mockResolvedValue({}) },
        projectStatusHistory: {
          create: jest.fn().mockResolvedValue({ id: "history-3", changedAt }),
        },
      };
      return callback(tx);
    });

    await expect(
      transitionProjectStatus({
        projectId: "proj-1",
        actorUserId: "admin-1",
        toStatus: ProjectStatus.APPROVED,
        isAdmin: true,
      })
    ).resolves.toMatchObject({ toStatus: ProjectStatus.APPROVED });
  });

  it("exposes structured lifecycle errors", () => {
    const error = new ProjectStatusTransitionError("x", 400, "NO_OP_TRANSITION");
    expect(error.code).toBe("NO_OP_TRANSITION");
    expect(error.statusCode).toBe(400);
  });
});
