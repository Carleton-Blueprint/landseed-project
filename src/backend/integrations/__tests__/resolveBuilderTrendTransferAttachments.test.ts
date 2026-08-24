/**
 * @jest-environment node
 */
jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  builderTrendTransferQueue: { add: jest.fn(), getJob: jest.fn() },
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

const mockedProjectFindUnique = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: (...args: unknown[]) => mockedProjectFindUnique(...args),
    },
  },
}));

import { resolveBuilderTrendTransferAttachments } from "../buildertrend";
import { getOrGenerateReadyEstimate } from "@/backend/services/estimateDocument";
import { getOrGenerateReadyGrantMatchSummary } from "@/backend/services/grantMatchSummaryDocument";
import { getObjectBuffer } from "lib/s3";

const mockedGetOrGenerateReadyEstimate = getOrGenerateReadyEstimate as jest.MockedFunction<
  typeof getOrGenerateReadyEstimate
>;
const mockedGetOrGenerateReadyGrantMatchSummary = getOrGenerateReadyGrantMatchSummary as jest.MockedFunction<
  typeof getOrGenerateReadyGrantMatchSummary
>;
const mockedGetObjectBuffer = getObjectBuffer as jest.MockedFunction<typeof getObjectBuffer>;

const transfer = { projectId: "project-1", quoteId: "quote-1" };

describe("resolveBuilderTrendTransferAttachments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedProjectFindUnique.mockResolvedValue({ userId: "user-1" });
  });

  it("returns both attachments as file buffers when both PDFs are ready", async () => {
    mockedGetOrGenerateReadyEstimate.mockResolvedValue({
      s3Key: "projects/project-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
    });
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue({
      s3Key: "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
    });
    mockedGetObjectBuffer
      .mockResolvedValueOnce(Buffer.from("estimate-bytes"))
      .mockResolvedValueOnce(Buffer.from("grant-match-summary-bytes"));

    const result = await resolveBuilderTrendTransferAttachments(transfer);

    expect(mockedGetOrGenerateReadyEstimate).toHaveBeenCalledWith("quote-1", "user-1");
    expect(mockedGetOrGenerateReadyGrantMatchSummary).toHaveBeenCalledWith("project-1", "user-1");
    expect(result).toEqual([
      { fileName: "estimate-v1.pdf", mimeType: "application/pdf", buffer: Buffer.from("estimate-bytes") },
      {
        fileName: "grant-match-summary-v1.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("grant-match-summary-bytes"),
      },
    ]);
  });

  it("returns only the estimate attachment when the grant match summary isn't ready", async () => {
    mockedGetOrGenerateReadyEstimate.mockResolvedValue({
      s3Key: "projects/project-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
    });
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue(null);
    mockedGetObjectBuffer.mockResolvedValue(Buffer.from("estimate-bytes"));

    const result = await resolveBuilderTrendTransferAttachments(transfer);

    expect(result).toEqual([
      { fileName: "estimate-v1.pdf", mimeType: "application/pdf", buffer: Buffer.from("estimate-bytes") },
    ]);
  });

  it("returns an empty array when neither PDF is ready", async () => {
    mockedGetOrGenerateReadyEstimate.mockResolvedValue(null);
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue(null);

    const result = await resolveBuilderTrendTransferAttachments(transfer);

    expect(result).toEqual([]);
    expect(mockedGetObjectBuffer).not.toHaveBeenCalled();
  });

  it("omits the estimate attachment when its S3 download fails, but still returns the grant match summary", async () => {
    mockedGetOrGenerateReadyEstimate.mockResolvedValue({
      s3Key: "projects/project-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
    });
    mockedGetOrGenerateReadyGrantMatchSummary.mockResolvedValue({
      s3Key: "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
    });
    mockedGetObjectBuffer
      .mockRejectedValueOnce(new Error("S3 unavailable"))
      .mockResolvedValueOnce(Buffer.from("grant-match-summary-bytes"));

    const result = await resolveBuilderTrendTransferAttachments(transfer);

    expect(result).toEqual([
      {
        fileName: "grant-match-summary-v1.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("grant-match-summary-bytes"),
      },
    ]);
  });

  it("returns an empty array without throwing when the project isn't found", async () => {
    mockedProjectFindUnique.mockResolvedValue(null);

    const result = await resolveBuilderTrendTransferAttachments(transfer);

    expect(result).toEqual([]);
    expect(mockedGetOrGenerateReadyEstimate).not.toHaveBeenCalled();
    expect(mockedGetOrGenerateReadyGrantMatchSummary).not.toHaveBeenCalled();
  });
});
