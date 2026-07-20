/**
 * @jest-environment node
 */
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { requestManualFallbackExport } from "@/backend/services/manualFallbackExport";
import { builderTrendTransferQueue } from "@/backend/queue";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  builderTrendTransferQueue: {
    add: jest.fn(),
    getJob: jest.fn(),
  },
}));

jest.mock("@/backend/services/manualFallbackExport", () => ({
  requestManualFallbackExport: jest.fn(),
}));

const mockedQueryRaw = jest.fn();
const mockedExecuteRaw = jest.fn();
const mockedProjectFindUnique = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockedQueryRaw(...args),
    $executeRaw: (...args: unknown[]) => mockedExecuteRaw(...args),
    project: {
      findUnique: (...args: unknown[]) => mockedProjectFindUnique(...args),
    },
  },
}));

const {
  processBuilderTrendTransfer,
  triggerManualFallbackForExhaustedTransfer,
  retryBuilderTrendTransfer,
} = require("../buildertrend") as typeof import("../buildertrend");

const mockedQueueGetJob = builderTrendTransferQueue.getJob as jest.MockedFunction<
  typeof builderTrendTransferQueue.getJob
>;
const mockedQueueAdd = builderTrendTransferQueue.add as jest.MockedFunction<typeof builderTrendTransferQueue.add>;

const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;
const mockedRequestManualFallbackExport = requestManualFallbackExport as jest.MockedFunction<
  typeof requestManualFallbackExport
>;

const baseTransferRow = {
  id: "transfer-1",
  projectId: "project-1",
  quoteId: "quote-1",
  status: "PENDING",
  attempts: 0,
  payload: null,
};

describe("processBuilderTrendTransfer", () => {
  const originalMockFailEnv = process.env.BUILDERTREND_MOCK_FAIL;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.BUILDERTREND_MOCK_FAIL = originalMockFailEnv;
  });

  it("returns early without re-querying status when the transfer is already SENT", async () => {
    mockedQueryRaw.mockResolvedValueOnce([{ ...baseTransferRow, status: "SENT" }]);

    await processBuilderTrendTransfer("transfer-1", { attemptsMade: 0, maxAttempts: 3 });

    expect(mockedExecuteRaw).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("marks the transfer SENT and logs attemptNumber 1 on a first-try success", async () => {
    process.env.BUILDERTREND_MOCK_FAIL = "false";
    mockedQueryRaw.mockResolvedValueOnce([baseTransferRow]);

    await processBuilderTrendTransfer("transfer-1", { attemptsMade: 0, maxAttempts: 3 });

    expect(mockedExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_SENT",
        outcome: "SUCCESS",
        metadata: expect.objectContaining({ transferStatus: "SENT", attemptNumber: 1 }),
      })
    );
  });

  it("sets status RETRYING and rethrows when a failure is not the final attempt", async () => {
    process.env.BUILDERTREND_MOCK_FAIL = "true";
    mockedQueryRaw.mockResolvedValueOnce([baseTransferRow]);

    await expect(
      processBuilderTrendTransfer("transfer-1", { attemptsMade: 0, maxAttempts: 3 })
    ).rejects.toThrow("Mocked BuilderTrend failure");

    expect(mockedExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockedExecuteRaw.mock.calls[0][0].values).toEqual(expect.arrayContaining(["RETRYING"]));
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_FAILED",
        metadata: expect.objectContaining({
          transferStatus: "RETRYING",
          attemptNumber: 1,
          maxAttempts: 3,
          isFinalAttempt: false,
        }),
      })
    );
  });

  it("sets terminal status FAILED and rethrows when the final retry attempt fails", async () => {
    process.env.BUILDERTREND_MOCK_FAIL = "true";
    mockedQueryRaw.mockResolvedValueOnce([{ ...baseTransferRow, attempts: 2 }]);

    await expect(
      processBuilderTrendTransfer("transfer-1", { attemptsMade: 2, maxAttempts: 3 })
    ).rejects.toThrow("Mocked BuilderTrend failure");

    expect(mockedExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockedExecuteRaw.mock.calls[0][0].values).toEqual(expect.arrayContaining(["FAILED"]));
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_FAILED",
        metadata: expect.objectContaining({
          transferStatus: "FAILED",
          attemptNumber: 3,
          maxAttempts: 3,
          isFinalAttempt: true,
        }),
      })
    );
  });
});

describe("triggerManualFallbackForExhaustedTransfer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("claims the transfer, requests a fallback export on behalf of the project owner, and logs an audit event", async () => {
    mockedQueryRaw.mockResolvedValueOnce([{ id: "transfer-1", projectId: "project-1" }]);
    mockedProjectFindUnique.mockResolvedValueOnce({
      id: "project-1",
      userId: "user-1",
      user: { email: "owner@example.com", name: "Project Owner" },
    });
    mockedRequestManualFallbackExport.mockResolvedValueOnce({
      exportRequestId: "export-1",
      projectId: "project-1",
      requestedByUserId: "user-1",
      requestedAt: "2026-07-13T00:00:00.000Z",
      retentionDays: 7,
    });

    await triggerManualFallbackForExhaustedTransfer("transfer-1");

    expect(mockedRequestManualFallbackExport).toHaveBeenCalledWith({
      projectId: "project-1",
      requestedByUserId: "user-1",
      requestedByEmail: "owner@example.com",
      requestedByName: "Project Owner",
    });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_FALLBACK_TRIGGERED",
        projectId: "project-1",
        resourceId: "transfer-1",
        metadata: expect.objectContaining({
          exportRequestId: "export-1",
          triggeredBy: "system:buildertrend-retry-exhausted",
        }),
      })
    );
  });

  it("does nothing when the transfer was already claimed (idempotency guard)", async () => {
    mockedQueryRaw.mockResolvedValueOnce([]);

    await triggerManualFallbackForExhaustedTransfer("transfer-1");

    expect(mockedProjectFindUnique).not.toHaveBeenCalled();
    expect(mockedRequestManualFallbackExport).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("does nothing when the transfer's project no longer exists", async () => {
    mockedQueryRaw.mockResolvedValueOnce([{ id: "transfer-1", projectId: "missing-project" }]);
    mockedProjectFindUnique.mockResolvedValueOnce(null);

    await triggerManualFallbackForExhaustedTransfer("transfer-1");

    expect(mockedRequestManualFallbackExport).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });
});

describe("retryBuilderTrendTransfer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("enqueues a fresh job when no job exists yet for this transfer", async () => {
    mockedQueryRaw.mockResolvedValueOnce([
      { id: "transfer-1", status: "FAILED", projectId: "project-1", quoteId: "quote-1" },
    ]);
    mockedQueueGetJob.mockResolvedValueOnce(undefined);

    const result = await retryBuilderTrendTransfer({ transferId: "transfer-1" });

    expect(mockedQueueAdd).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ previousStatus: "FAILED", alreadyQueued: false });
  });

  it("retries the existing job in place when it already exists but is dead (failed/completed)", async () => {
    mockedQueryRaw.mockResolvedValueOnce([
      { id: "transfer-1", status: "FAILED", projectId: "project-1", quoteId: "quote-1" },
    ]);
    const mockedRetry = jest.fn();
    mockedQueueGetJob.mockResolvedValueOnce({
      getState: jest.fn().mockResolvedValue("failed"),
      retry: mockedRetry,
    } as never);

    const result = await retryBuilderTrendTransfer({ transferId: "transfer-1" });

    expect(mockedRetry).toHaveBeenCalledTimes(1);
    expect(mockedRetry).toHaveBeenCalledWith("failed", { resetAttemptsMade: true });
    expect(mockedQueueAdd).not.toHaveBeenCalled();
    expect(result).toEqual({ previousStatus: "FAILED", alreadyQueued: false });
  });

  it("does nothing to the queue when the job is still in flight (waiting/active/delayed)", async () => {
    mockedQueryRaw.mockResolvedValueOnce([
      { id: "transfer-1", status: "RETRYING", projectId: "project-1", quoteId: "quote-1" },
    ]);
    const mockedRetry = jest.fn();
    mockedQueueGetJob.mockResolvedValueOnce({
      getState: jest.fn().mockResolvedValue("waiting"),
      retry: mockedRetry,
    } as never);

    const result = await retryBuilderTrendTransfer({ transferId: "transfer-1" });

    expect(mockedRetry).not.toHaveBeenCalled();
    expect(mockedQueueAdd).not.toHaveBeenCalled();
    expect(result).toEqual({ previousStatus: "RETRYING", alreadyQueued: true });
  });

  it("throws when the transfer has already been sent", async () => {
    mockedQueryRaw.mockResolvedValueOnce([
      { id: "transfer-1", status: "SENT", projectId: "project-1", quoteId: "quote-1" },
    ]);

    await expect(retryBuilderTrendTransfer({ transferId: "transfer-1" })).rejects.toThrow(
      "Cannot retry a transfer that has already been sent"
    );

    expect(mockedQueueGetJob).not.toHaveBeenCalled();
  });
});
