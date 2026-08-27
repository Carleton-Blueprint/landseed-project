import { notifyEstimateUpdated, buildEstimateUpdatedIdempotencyKey } from "../estimateUpdatedNotification";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";

jest.mock("@/backend/notifications/enqueue", () => ({
  enqueueNotification: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
  },
}));

describe("notifyEstimateUpdated", () => {
  const mockedPrisma = prisma as unknown as { project: { findUnique: jest.Mock } };
  const mockedEnqueue = enqueueNotification as jest.MockedFunction<typeof enqueueNotification>;
  const mockedLogAuditEvent = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

  const overriddenAt = new Date("2026-08-27T12:00:00Z");

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_BASE_URL;
    delete process.env.NEXTAUTH_URL;
  });

  it("enqueues an ESTIMATE_UPDATED notification with the before/after totals", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "10 Main St",
      user: { id: "user-1", name: "Client A", email: "client@example.com" },
    });

    const result = await notifyEstimateUpdated({
      projectId: "proj-1",
      quoteId: "quote-1",
      overrideId: "override-1",
      overriddenAt,
      previousTotal: 1200,
      newTotal: 1450,
    });

    const expectedKey = buildEstimateUpdatedIdempotencyKey("override-1", overriddenAt);

    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
    expect(mockedEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ESTIMATE_UPDATED",
        idempotencyKey: expectedKey,
        recipientEmail: "client@example.com",
        projectId: "proj-1",
        previousTotal: 1200,
        newTotal: 1450,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        notified: true,
        notificationIdempotencyKey: expectedKey,
        notificationQueuedAt: expect.any(String),
      })
    );
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ESTIMATE_UPDATED_NOTIFICATION_QUEUED",
        resourceId: expectedKey,
        projectId: "proj-1",
        quoteId: "quote-1",
      })
    );
  });

  it("produces a different idempotency key for a second override on the same quote", async () => {
    const firstKey = buildEstimateUpdatedIdempotencyKey("override-1", overriddenAt);
    const secondKey = buildEstimateUpdatedIdempotencyKey("override-1", new Date("2026-08-28T00:00:00Z"));

    expect(firstKey).not.toBe(secondKey);
  });

  it("does not enqueue when the recipient has no email, and reports skipped", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "10 Main St",
      user: { id: "user-1", name: "Client A", email: null },
    });

    const result = await notifyEstimateUpdated({
      projectId: "proj-1",
      quoteId: "quote-1",
      overrideId: "override-1",
      overriddenAt,
      previousTotal: 1200,
      newTotal: 1450,
    });

    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ notified: false, skippedReason: "MISSING_RECIPIENT_EMAIL" })
    );
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ESTIMATE_UPDATED_NOTIFICATION_SKIPPED" })
    );
  });

  it("throws when the project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    await expect(
      notifyEstimateUpdated({
        projectId: "missing",
        quoteId: "quote-1",
        overrideId: "override-1",
        overriddenAt,
        previousTotal: 1200,
        newTotal: 1450,
      })
    ).rejects.toThrow("Project not found");

    expect(mockedEnqueue).not.toHaveBeenCalled();
  });
});
