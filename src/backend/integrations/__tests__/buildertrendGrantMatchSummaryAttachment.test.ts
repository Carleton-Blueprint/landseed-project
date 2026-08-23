/**
 * @jest-environment node
 */
jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/services/grantMatchSummaryDocument", () => ({
  getOrGenerateReadyGrantMatchSummary: jest.fn(),
}));

jest.mock("@/backend/services/estimateDocument", () => ({
  getOrGenerateReadyEstimate: jest.fn(),
}));

jest.mock("@/backend/services/manualFallbackExport", () => ({
  requestManualFallbackExport: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  builderTrendTransferQueue: { add: jest.fn(), getJob: jest.fn() },
}));

jest.mock("lib/s3", () => ({
  getObjectBuffer: jest.fn(),
}));

const mockedFindFirst = jest.fn();
const mockedUpdate = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    builderTrendTransfer: {
      findFirst: (...args: unknown[]) => mockedFindFirst(...args),
      update: (...args: unknown[]) => mockedUpdate(...args),
    },
  },
}));

import { attachGrantMatchSummaryToBuilderTrendTransfer } from "../buildertrend";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { getOrGenerateReadyGrantMatchSummary } from "@/backend/services/grantMatchSummaryDocument";

const mockedAudit = logAuditEventNonBlocking as jest.Mock;
const mockedGetOrGenerateReadyGrantMatchSummary = getOrGenerateReadyGrantMatchSummary as jest.Mock;

describe("attachGrantMatchSummaryToBuilderTrendTransfer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("no-ops when no BuilderTrend transfer exists yet for the project", async () => {
    mockedFindFirst.mockResolvedValue(null);

    const result = await attachGrantMatchSummaryToBuilderTrendTransfer("project-1", "user-1");

    expect(result).toEqual({ attached: false, transferId: null });
    expect(mockedGetOrGenerateReadyGrantMatchSummary).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("no-ops when a transfer exists but no Grant Match Summary is available", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "transfer-1",
      projectId: "project-1",
      quoteId: "quote-1",
    });
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue(null);

    const result = await attachGrantMatchSummaryToBuilderTrendTransfer("project-1", "user-1");

    expect(result).toEqual({ attached: false, transferId: "transfer-1" });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("eagerly generates the Grant Match Summary and audit-logs it, without mutating the transfer's stored payload", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "transfer-1",
      projectId: "project-1",
      quoteId: "quote-1",
    });
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue({
      s3Key: "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
    });

    const result = await attachGrantMatchSummaryToBuilderTrendTransfer("project-1", "user-1");

    expect(mockedGetOrGenerateReadyGrantMatchSummary).toHaveBeenCalledWith("project-1", "user-1");
    // Attachments are now resolved fresh from the document tables at send time
    // (see resolveBuilderTrendTransferAttachments in buildertrend.ts), so this
    // no longer patches the transfer's stored payload.
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_ATTACHMENT_ADDED",
        outcome: "SUCCESS",
        projectId: "project-1",
        resourceId: "transfer-1",
        metadata: expect.objectContaining({ fileName: "grant-match-summary-v1.pdf" }),
      })
    );
    expect(result).toEqual({ attached: true, transferId: "transfer-1" });
  });
});
