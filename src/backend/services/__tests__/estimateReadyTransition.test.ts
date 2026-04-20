import { markEstimateReadyForReview } from "../estimateReadyTransition";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import { prisma } from "lib/prisma";
import { ESTIMATE_READY_TRIGGER_SOURCE } from "@/backend/notifications/estimateReadyContract";

jest.mock("@/backend/notifications/enqueue", () => ({
  enqueueNotification: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    quote: {
      findUnique: jest.fn(),
    },
  },
}));

describe("markEstimateReadyForReview", () => {
  const mockedPrisma = prisma as unknown as {
    project: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    quote: {
      findUnique: jest.Mock;
    };
  };
  const mockedEnqueue = enqueueNotification as jest.MockedFunction<typeof enqueueNotification>;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_BASE_URL;
    delete process.env.NEXTAUTH_URL;
  });

  it("updates project to estimate_ready and enqueues ESTIMATE_READY notification", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: "submitted",
      address: "10 Main St",
      user: { id: "user-1", name: "Client A", email: "client@example.com" },
    });
    mockedPrisma.quote.findUnique.mockResolvedValue({ id: "quote-1", projectId: "proj-1" });
    mockedPrisma.project.update.mockResolvedValue({ id: "proj-1", status: "estimate_ready" });

    const result = await markEstimateReadyForReview({
      projectId: "proj-1",
      quoteId: "quote-1",
      triggerSource: ESTIMATE_READY_TRIGGER_SOURCE.ADVISORY_TEAM_MARK_READY_FOR_REVIEW,
    });

    expect(mockedPrisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { status: "estimate_ready" },
    });
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(mockedEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ESTIMATE_READY",
        idempotencyKey: "estimate-ready:quote-1",
        recipientEmail: "client@example.com",
        projectId: "proj-1",
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        notified: true,
        triggerSource:
          ESTIMATE_READY_TRIGGER_SOURCE.ADVISORY_TEAM_MARK_READY_FOR_REVIEW,
      })
    );
  });

  it("does not enqueue when recipient email is missing", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: "submitted",
      address: "10 Main St",
      user: { id: "user-1", name: "Client A", email: null },
    });
    mockedPrisma.quote.findUnique.mockResolvedValue({ id: "quote-1", projectId: "proj-1" });
    mockedPrisma.project.update.mockResolvedValue({ id: "proj-1", status: "estimate_ready" });

    const result = await markEstimateReadyForReview({
      projectId: "proj-1",
      quoteId: "quote-1",
      triggerSource: ESTIMATE_READY_TRIGGER_SOURCE.ADVISORY_TEAM_MARK_READY_FOR_REVIEW,
    });

    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        notified: false,
        skippedReason: "MISSING_RECIPIENT_EMAIL",
      })
    );
  });

  it("throws when quote does not belong to project", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: "submitted",
      address: "10 Main St",
      user: { id: "user-1", name: "Client A", email: "client@example.com" },
    });
    mockedPrisma.quote.findUnique.mockResolvedValue({ id: "quote-1", projectId: "proj-2" });

    await expect(
      markEstimateReadyForReview({
        projectId: "proj-1",
        quoteId: "quote-1",
        triggerSource: ESTIMATE_READY_TRIGGER_SOURCE.ADVISORY_TEAM_MARK_READY_FOR_REVIEW,
      })
    ).rejects.toThrow("does not belong to project");

    expect(mockedEnqueue).not.toHaveBeenCalled();
  });
});
