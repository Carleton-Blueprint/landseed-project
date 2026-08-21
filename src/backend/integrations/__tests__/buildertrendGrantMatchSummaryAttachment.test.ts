/**
 * @jest-environment node
 */
jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/services/grantMatchSummaryDocument", () => ({
  getOrGenerateReadyGrantMatchSummary: jest.fn(),
}));

jest.mock("@/backend/services/manualFallbackExport", () => ({
  requestManualFallbackExport: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  builderTrendTransferQueue: { add: jest.fn(), getJob: jest.fn() },
}));

jest.mock("lib/s3", () => ({
  getSignedDownloadUrl: jest.fn(),
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
import { getSignedDownloadUrl } from "lib/s3";

const mockedAudit = logAuditEventNonBlocking as jest.Mock;
const mockedGetOrGenerateReadyGrantMatchSummary = getOrGenerateReadyGrantMatchSummary as jest.Mock;
const mockedGetSignedDownloadUrl = getSignedDownloadUrl as jest.Mock;

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
      payload: { schemaVersion: 1 },
    });
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue(null);

    const result = await attachGrantMatchSummaryToBuilderTrendTransfer("project-1", "user-1");

    expect(result).toEqual({ attached: false, transferId: "transfer-1" });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("merges the attachment into the existing payload and audit-logs the update", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "transfer-1",
      projectId: "project-1",
      quoteId: "quote-1",
      payload: { schemaVersion: 1, client: { name: "Jane Client" } },
    });
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue({
      s3Key: "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
    });
    mockedGetSignedDownloadUrl.mockResolvedValue("https://signed.example.com/grant-match-summary-v1.pdf");

    const result = await attachGrantMatchSummaryToBuilderTrendTransfer("project-1", "user-1");

    expect(mockedGetOrGenerateReadyGrantMatchSummary).toHaveBeenCalledWith("project-1", "user-1");
    expect(mockedGetSignedDownloadUrl).toHaveBeenCalledWith(
      "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf",
      3600
    );
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "transfer-1" },
      data: {
        payload: {
          schemaVersion: 1,
          client: { name: "Jane Client" },
          attachments: [{ label: "Grant Match Summary", url: "https://signed.example.com/grant-match-summary-v1.pdf" }],
        },
      },
    });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUILDERTREND_TRANSFER_ATTACHMENT_ADDED",
        outcome: "SUCCESS",
        projectId: "project-1",
        resourceId: "transfer-1",
      })
    );
    expect(result).toEqual({ attached: true, transferId: "transfer-1" });
  });
});
