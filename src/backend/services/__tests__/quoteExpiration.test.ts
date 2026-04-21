import { NotificationEventType, QuoteStatus } from "@prisma/client";
import { expireInactiveQuotes } from "../quoteExpiration";
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { enqueueNotification } from "@/backend/notifications/enqueue";

jest.mock("lib/prisma", () => ({
  prisma: {
    quote: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    project: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/backend/notifications/enqueue", () => ({
  enqueueNotification: jest.fn().mockResolvedValue(undefined),
}));

describe("expireInactiveQuotes", () => {
  const mockedPrisma = prisma as unknown as {
    quote: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    project: {
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        quote: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        project: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return callback(tx);
    });
  });

  it("returns zero work when no stale quotes exist", async () => {
    mockedPrisma.quote.findMany.mockResolvedValue([]);

    const result = await expireInactiveQuotes({ inactivityDays: 30, batchSize: 10 });

    expect(result.expired).toBe(0);
    expect(result.scanned).toBe(0);
    expect(logAuditEventNonBlocking).not.toHaveBeenCalled();
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it("expires stale quotes and enqueues notifications", async () => {
    const lastClientActivityAt = new Date("2026-03-01T00:00:00.000Z");

    mockedPrisma.quote.findMany
      .mockResolvedValueOnce([
        {
          id: "q1",
          projectId: "p1",
          status: QuoteStatus.PENDING,
          lastClientActivityAt,
          project: {
            status: "estimate_ready",
            address: "1 Test Lane",
            user: {
              id: "u1",
              name: "Client One",
              email: "client@example.com",
            },
          },
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await expireInactiveQuotes({ inactivityDays: 30, batchSize: 10 });

    expect(result.expired).toBe(1);
    expect(result.scanned).toBe(1);
    expect(logAuditEventNonBlocking).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: NotificationEventType.ESTIMATE_EXPIRED,
        projectId: "p1",
        recipientEmail: "client@example.com",
      })
    );
  });
});