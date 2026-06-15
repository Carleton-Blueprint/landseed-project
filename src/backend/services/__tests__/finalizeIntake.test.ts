import { finalizeIntake } from "../finalizeIntake";
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

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

  beforeEach(() => {
    jest.clearAllMocks();
    mockedProjectUpdateMany.mockReset();
  });

  it("transitions draft project even when no photos are present", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: "draft",
      userId: "user-1",
      photos: [],
      quotes: [],
    });

    mockedProjectUpdateMany.mockResolvedValue({ count: 1 });

    const result = await finalizeIntake({
      projectId: "proj-1",
      actorUserId: "user-1",
    });

    expect(result).toEqual({
      ok: true,
      projectId: "proj-1",
      status: "submitted",
      message: "Intake finalized successfully.",
    });

    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "INTAKE_FINALIZED",
        projectId: "proj-1",
      })
    );
  });

  it("returns idempotent result for already finalized project", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-2",
      status: "submitted",
      userId: "user-2",
      photos: [{ id: "photo-1" }],
      quotes: [
        {
          id: "quote-1",
          estimateMin: { toString: () => "1000.00" },
          estimateMax: { toString: () => "1500.00" },
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
      },
    });

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("transitions draft project to submitted and logs one finalization audit event", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-3",
      status: "draft",
      userId: "user-3",
      photos: [{ id: "photo-1" }],
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
      message: "Intake finalized successfully.",
    });

    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedProjectUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "proj-3",
        status: "draft",
      },
      data: {
        status: "submitted",
      },
    });

    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "INTAKE_FINALIZED",
        projectId: "proj-3",
        outcome: "SUCCESS",
      })
    );
  });
});
