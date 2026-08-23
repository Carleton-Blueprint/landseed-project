/**
 * @jest-environment node
 */
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { requestManualFallbackExport } from "@/backend/services/manualFallbackExport";
import { getOrGenerateReadyEstimate } from "@/backend/services/estimateDocument";
import { getOrGenerateReadyGrantMatchSummary } from "@/backend/services/grantMatchSummaryDocument";
import { getObjectBuffer } from "lib/s3";
import { builderTrendTransferQueue } from "@/backend/queue";
import {
  processBuilderTrendTransfer,
  triggerManualFallbackForExhaustedTransfer,
  triggerBuilderTrendTransferForApprovedGrant,
  retryBuilderTrendTransfer,
} from "../buildertrend";

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

jest.mock("@/backend/services/estimateDocument", () => ({
  getOrGenerateReadyEstimate: jest.fn(),
}));

jest.mock("@/backend/services/grantMatchSummaryDocument", () => ({
  getOrGenerateReadyGrantMatchSummary: jest.fn(),
}));

jest.mock("lib/s3", () => ({
  getObjectBuffer: jest.fn(),
}));

const mockedQueryRaw = jest.fn();
const mockedExecuteRaw = jest.fn();
const mockedProjectFindUnique = jest.fn();
const mockedQuoteFindUnique = jest.fn();
const mockedBuilderTrendTransferFindFirst = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockedQueryRaw(...args),
    $executeRaw: (...args: unknown[]) => mockedExecuteRaw(...args),
    project: {
      findUnique: (...args: unknown[]) => mockedProjectFindUnique(...args),
    },
    quote: {
      findUnique: (...args: unknown[]) => mockedQuoteFindUnique(...args),
    },
    builderTrendTransfer: {
      findFirst: (...args: unknown[]) => mockedBuilderTrendTransferFindFirst(...args),
    },
  },
}));

const mockedQueueGetJob = builderTrendTransferQueue.getJob as jest.MockedFunction<
  typeof builderTrendTransferQueue.getJob
>;
const mockedQueueAdd = builderTrendTransferQueue.add as jest.MockedFunction<typeof builderTrendTransferQueue.add>;

const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;
const mockedRequestManualFallbackExport = requestManualFallbackExport as jest.MockedFunction<
  typeof requestManualFallbackExport
>;
const mockedGetOrGenerateReadyEstimate = getOrGenerateReadyEstimate as jest.MockedFunction<
  typeof getOrGenerateReadyEstimate
>;
const mockedGetOrGenerateReadyGrantMatchSummary = getOrGenerateReadyGrantMatchSummary as jest.MockedFunction<
  typeof getOrGenerateReadyGrantMatchSummary
>;
const mockedGetObjectBuffer = getObjectBuffer as jest.MockedFunction<typeof getObjectBuffer>;

const baseTransferRow = {
  id: "transfer-1",
  projectId: "project-1",
  quoteId: "quote-1",
  status: "PENDING",
  attempts: 0,
  payload: { schemaVersion: 2, project: { id: "project-1", address: "1 Main St" }, client: {}, modificationType: [], totalEstimate: 500 },
};

describe("processBuilderTrendTransfer", () => {
  const originalMockFailEnv = process.env.BUILDERTREND_MOCK_FAIL;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedQuoteFindUnique.mockResolvedValue({ id: "quote-1", projectId: "project-1", status: "ACCEPTED" });
    mockedProjectFindUnique.mockResolvedValue({ userId: "user-1" });
    mockedGetOrGenerateReadyEstimate.mockResolvedValue(null);
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue(null);
    mockedGetObjectBuffer.mockResolvedValue(Buffer.from("pdf-bytes"));
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

  it("marks the transfer FAILED and logs a blocked audit event when the quote is not accepted", async () => {
    mockedQueryRaw.mockResolvedValueOnce([baseTransferRow]);
    mockedQuoteFindUnique.mockResolvedValue({ id: "quote-1", projectId: "project-1", status: "DECLINED" });

    await processBuilderTrendTransfer("transfer-1", { attemptsMade: 0, maxAttempts: 3 });

    expect(mockedExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockedExecuteRaw.mock.calls[0][0].sql).toContain("'FAILED'::\"BuilderTrendTransferStatus\"");
    expect(mockedExecuteRaw.mock.calls[0][0].values).toEqual(
      expect.arrayContaining(["Work order creation blocked: ESTIMATE_DECLINED"])
    );
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WORK_ORDER_CREATION_BLOCKED",
        outcome: "DENIED",
        quoteId: "quote-1",
        projectId: "project-1",
        metadata: expect.objectContaining({ reason: "ESTIMATE_DECLINED" }),
      })
    );
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
        metadata: expect.objectContaining({
          transferStatus: "SENT",
          attemptNumber: 1,
          attachmentCount: 0,
          attachmentFileNames: [],
        }),
      })
    );
  });

  it("resolves the Estimate and Grant Match Summary PDFs as file buffers and includes them in the sent audit metadata", async () => {
    process.env.BUILDERTREND_MOCK_FAIL = "false";
    mockedQueryRaw.mockResolvedValueOnce([baseTransferRow]);
    mockedGetOrGenerateReadyEstimate.mockResolvedValue({
      s3Key: "projects/project-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
    });
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue({
      s3Key: "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
    });

    await processBuilderTrendTransfer("transfer-1", { attemptsMade: 0, maxAttempts: 3 });

    expect(mockedGetOrGenerateReadyEstimate).toHaveBeenCalledWith("quote-1", "user-1");
    expect(mockedGetOrGenerateReadyGrantMatchSummary).toHaveBeenCalledWith("project-1", "user-1");
    expect(mockedGetObjectBuffer).toHaveBeenCalledWith("projects/project-1/estimate/estimate-v1.pdf");
    expect(mockedGetObjectBuffer).toHaveBeenCalledWith(
      "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf"
    );
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_SENT",
        metadata: expect.objectContaining({
          attachmentCount: 2,
          attachmentFileNames: ["estimate-v1.pdf", "grant-match-summary-v1.pdf"],
        }),
      })
    );
  });

  it("omits an attachment whose S3 download fails, without failing the transfer", async () => {
    process.env.BUILDERTREND_MOCK_FAIL = "false";
    mockedQueryRaw.mockResolvedValueOnce([baseTransferRow]);
    mockedGetOrGenerateReadyEstimate.mockResolvedValue({
      s3Key: "projects/project-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
    });
    mockedGetObjectBuffer.mockRejectedValueOnce(new Error("S3 unavailable"));

    await processBuilderTrendTransfer("transfer-1", { attemptsMade: 0, maxAttempts: 3 });

    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_SENT",
        metadata: expect.objectContaining({ attachmentCount: 0, attachmentFileNames: [] }),
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

describe("triggerBuilderTrendTransferForApprovedGrant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("enqueues the PENDING transfer and logs an audit event", async () => {
    mockedBuilderTrendTransferFindFirst.mockResolvedValue({ id: "transfer-1", quoteId: "quote-1" });

    const result = await triggerBuilderTrendTransferForApprovedGrant("project-1", "user-1");

    expect(mockedBuilderTrendTransferFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "project-1", status: "PENDING" } })
    );
    expect(mockedQueueAdd).toHaveBeenCalledWith(
      "buildertrend-transfer:transfer-1",
      { transferId: "transfer-1" },
      expect.objectContaining({ jobId: "transfer-1" })
    );
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_TRIGGERED_BY_GRANT_APPROVAL",
        outcome: "SUCCESS",
        actorUserId: "user-1",
        projectId: "project-1",
        quoteId: "quote-1",
        resourceId: "transfer-1",
      })
    );
    expect(result).toEqual({ triggered: true, transferId: "transfer-1" });
  });

  it("no-ops when no PENDING transfer exists for the project (none created yet, or already past PENDING)", async () => {
    mockedBuilderTrendTransferFindFirst.mockResolvedValue(null);

    const result = await triggerBuilderTrendTransferForApprovedGrant("project-1", "user-1");

    expect(mockedQueueAdd).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
    expect(result).toEqual({ triggered: false, transferId: null });
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
