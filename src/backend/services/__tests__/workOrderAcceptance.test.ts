import {
  assertQuoteAcceptedForWorkOrder,
  logWorkOrderCreationBlocked,
  WorkOrderCreationBlockedError,
} from "../workOrderAcceptance";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    quote: {
      findUnique: jest.fn(),
    },
  },
}));

describe("assertQuoteAcceptedForWorkOrder", () => {
  const mockedFindUnique = prisma.quote.findUnique as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the quote when status is ACCEPTED", async () => {
    mockedFindUnique.mockResolvedValue({ id: "quote-1", projectId: "proj-1", status: "ACCEPTED" });

    const result = await assertQuoteAcceptedForWorkOrder("quote-1");

    expect(result).toEqual({ id: "quote-1", projectId: "proj-1", status: "ACCEPTED" });
  });

  it("throws QUOTE_NOT_FOUND when the quote does not exist", async () => {
    mockedFindUnique.mockResolvedValue(null);

    await expect(assertQuoteAcceptedForWorkOrder("missing")).rejects.toMatchObject({
      reason: "QUOTE_NOT_FOUND",
    });
  });

  it.each([
    ["PENDING", "ESTIMATE_NOT_ACCEPTED"],
    ["DECLINED", "ESTIMATE_DECLINED"],
    ["EXPIRED", "ESTIMATE_EXPIRED"],
  ])("throws %s -> %s", async (status, reason) => {
    mockedFindUnique.mockResolvedValue({ id: "quote-1", projectId: "proj-1", status });

    const error = await assertQuoteAcceptedForWorkOrder("quote-1").catch((e) => e);

    expect(error).toBeInstanceOf(WorkOrderCreationBlockedError);
    expect(error.reason).toBe(reason);
  });
});

describe("logWorkOrderCreationBlocked", () => {
  const mockedLogAuditEvent = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs a DENIED audit event with the block reason and source", async () => {
    await logWorkOrderCreationBlocked({
      quoteId: "quote-1",
      projectId: "proj-1",
      reason: "ESTIMATE_DECLINED",
      source: "MANUAL",
      actorUserId: "user-1",
    });

    expect(mockedLogAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WORK_ORDER_CREATION_BLOCKED",
        outcome: "DENIED",
        quoteId: "quote-1",
        projectId: "proj-1",
        actorUserId: "user-1",
        metadata: { reason: "ESTIMATE_DECLINED", source: "MANUAL" },
      })
    );
  });
});
