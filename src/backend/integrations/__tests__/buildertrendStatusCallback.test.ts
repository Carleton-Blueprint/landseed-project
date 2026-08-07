/**
 * @jest-environment node
 */
import { logAuditEventNonBlocking } from "@/backend/audit/log";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

// buildertrend.ts imports these two at module scope even though this file only
// exercises the status-callback / manual-sync functions; without mocking them,
// requiring the real modules attempts a real BullMQ/Redis connection and hangs.
jest.mock("@/backend/queue", () => ({
  builderTrendTransferQueue: {
    add: jest.fn(),
    getJob: jest.fn(),
  },
}));

jest.mock("@/backend/services/manualFallbackExport", () => ({
  requestManualFallbackExport: jest.fn(),
}));

const mockedTransferFindFirst = jest.fn();
const mockedTransferFindUnique = jest.fn();
const mockedTransferUpdate = jest.fn();
const mockedProjectUpdate = jest.fn();
const mockedCallbackEventCreate = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    builderTrendTransfer: {
      findFirst: (...args: unknown[]) => mockedTransferFindFirst(...args),
      findUnique: (...args: unknown[]) => mockedTransferFindUnique(...args),
      update: (...args: unknown[]) => mockedTransferUpdate(...args),
    },
    project: {
      update: (...args: unknown[]) => mockedProjectUpdate(...args),
    },
    builderTrendStatusCallbackEvent: {
      create: (...args: unknown[]) => mockedCallbackEventCreate(...args),
    },
  },
}));

const {
  processBuilderTrendStatusCallback,
  recordBuilderTrendManualSync,
  BuilderTrendStatusCallbackError,
} = require("../buildertrend") as typeof import("../buildertrend");

const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

describe("processBuilderTrendStatusCallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs a FAILURE audit event and throws TRANSFER_NOT_FOUND when no transfer matches the externalReference", async () => {
    mockedTransferFindFirst.mockResolvedValueOnce(null);

    await expect(
      processBuilderTrendStatusCallback({
        externalReference: "bt-unknown",
        status: "SCHEDULED",
        rawPayload: { raw: true },
      })
    ).rejects.toMatchObject({
      code: "TRANSFER_NOT_FOUND",
    });

    expect(mockedTransferUpdate).not.toHaveBeenCalled();
    expect(mockedProjectUpdate).not.toHaveBeenCalled();
    expect(mockedCallbackEventCreate).not.toHaveBeenCalled();
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_STATUS_CALLBACK_UNMATCHED",
        outcome: "FAILURE",
        resourceType: "buildertrend_callback",
        resourceId: "bt-unknown",
        metadata: { externalReference: "bt-unknown", status: "SCHEDULED" },
      })
    );
  });

  it("throws an instance of BuilderTrendStatusCallbackError when the transfer isn't found", async () => {
    mockedTransferFindFirst.mockResolvedValueOnce(null);

    await expect(
      processBuilderTrendStatusCallback({
        externalReference: "bt-unknown",
        status: "SCHEDULED",
        rawPayload: {},
      })
    ).rejects.toBeInstanceOf(BuilderTrendStatusCallbackError);
  });

  it("maps a recognized status, updates the project status when it differs, and logs SUCCESS", async () => {
    mockedTransferFindFirst.mockResolvedValueOnce({
      id: "transfer-1",
      projectId: "project-1",
      externalStatus: null,
      project: { id: "project-1", status: "draft" },
    });
    mockedCallbackEventCreate.mockResolvedValueOnce({ id: "event-1" });

    const result = await processBuilderTrendStatusCallback({
      externalReference: "bt-ref-1",
      status: "IN_PROGRESS",
      workOrderUrl: "https://buildertrend.example.com/wo/1",
      rawPayload: { status: "IN_PROGRESS" },
    });

    expect(mockedTransferUpdate).toHaveBeenCalledWith({
      where: { id: "transfer-1" },
      data: {
        externalStatus: "IN_PROGRESS",
        lastStatusCallbackAt: expect.any(Date),
        workOrderUrl: "https://buildertrend.example.com/wo/1",
      },
    });
    expect(mockedProjectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { status: "work_in_progress" },
    });
    expect(mockedCallbackEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        builderTrendTransferId: "transfer-1",
        externalReference: "bt-ref-1",
        previousStatus: null,
        newStatus: "IN_PROGRESS",
        previousProjectStatus: "draft",
        newProjectStatus: "work_in_progress",
        validationError: null,
      }),
    });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_STATUS_CALLBACK_RECEIVED",
        outcome: "SUCCESS",
        projectId: "project-1",
        resourceId: "transfer-1",
        metadata: { callbackEventId: "event-1", workOrderUrl: "https://buildertrend.example.com/wo/1" },
      })
    );
    expect(result).toEqual({
      callbackEventId: "event-1",
      transferId: "transfer-1",
      projectId: "project-1",
      previousExternalStatus: null,
      newExternalStatus: "IN_PROGRESS",
      previousProjectStatus: "draft",
      newProjectStatus: "work_in_progress",
      mapped: true,
    });
  });

  it("skips project.update when the mapped status matches the project's current status", async () => {
    mockedTransferFindFirst.mockResolvedValueOnce({
      id: "transfer-1",
      projectId: "project-1",
      externalStatus: "SCHEDULED",
      project: { id: "project-1", status: "work_scheduled" },
    });
    mockedCallbackEventCreate.mockResolvedValueOnce({ id: "event-2" });

    const result = await processBuilderTrendStatusCallback({
      externalReference: "bt-ref-1",
      status: "SCHEDULED",
      rawPayload: { status: "SCHEDULED" },
    });

    expect(mockedTransferUpdate).toHaveBeenCalledTimes(1);
    expect(mockedProjectUpdate).not.toHaveBeenCalled();
    expect(result.newProjectStatus).toBe("work_scheduled");
    expect(result.mapped).toBe(true);
  });

  it("does not include workOrderUrl in the transfer update when it isn't provided", async () => {
    mockedTransferFindFirst.mockResolvedValueOnce({
      id: "transfer-1",
      projectId: "project-1",
      externalStatus: "SCHEDULED",
      project: { id: "project-1", status: "work_scheduled" },
    });
    mockedCallbackEventCreate.mockResolvedValueOnce({ id: "event-2b" });

    await processBuilderTrendStatusCallback({
      externalReference: "bt-ref-1",
      status: "SCHEDULED",
      rawPayload: {},
    });

    expect(mockedTransferUpdate).toHaveBeenCalledWith({
      where: { id: "transfer-1" },
      data: {
        externalStatus: "SCHEDULED",
        lastStatusCallbackAt: expect.any(Date),
      },
    });
  });

  it("leaves the project status unchanged, records a validationError, and logs FAILURE for an unrecognized status", async () => {
    mockedTransferFindFirst.mockResolvedValueOnce({
      id: "transfer-1",
      projectId: "project-1",
      externalStatus: null,
      project: { id: "project-1", status: "draft" },
    });
    mockedCallbackEventCreate.mockResolvedValueOnce({ id: "event-3" });

    const result = await processBuilderTrendStatusCallback({
      externalReference: "bt-ref-1",
      status: "SOME_UNKNOWN_STATUS",
      rawPayload: { status: "SOME_UNKNOWN_STATUS" },
    });

    expect(mockedProjectUpdate).not.toHaveBeenCalled();
    expect(mockedCallbackEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newProjectStatus: null,
        validationError: 'Unrecognized BuilderTrend status: "SOME_UNKNOWN_STATUS"',
      }),
    });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_STATUS_CALLBACK_RECEIVED",
        outcome: "FAILURE",
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        previousProjectStatus: "draft",
        newProjectStatus: null,
        mapped: false,
      })
    );
  });
});

describe("recordBuilderTrendManualSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws TRANSFER_NOT_FOUND when the transfer doesn't exist", async () => {
    mockedTransferFindUnique.mockResolvedValueOnce(null);

    await expect(
      recordBuilderTrendManualSync({ transferId: "missing-transfer", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_FOUND" });

    expect(mockedTransferUpdate).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("updates lastManualSyncAt/lastManualSyncByUserId and logs a SUCCESS audit event", async () => {
    mockedTransferFindUnique.mockResolvedValueOnce({
      id: "transfer-1",
      projectId: "project-1",
      quoteId: "quote-1",
    });

    const result = await recordBuilderTrendManualSync({ transferId: "transfer-1", actorUserId: "user-1" });

    expect(mockedTransferUpdate).toHaveBeenCalledWith({
      where: { id: "transfer-1" },
      data: { lastManualSyncAt: expect.any(Date), lastManualSyncByUserId: "user-1" },
    });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_MANUAL_SYNC",
        outcome: "SUCCESS",
        actorUserId: "user-1",
        projectId: "project-1",
        quoteId: "quote-1",
        resourceId: "transfer-1",
      })
    );
    expect(result.transferId).toBe("transfer-1");
    expect(result.lastManualSyncAt).toBeInstanceOf(Date);
  });
});
