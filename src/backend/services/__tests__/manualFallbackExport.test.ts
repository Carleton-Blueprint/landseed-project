import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// The real "archiver" package is ESM-only (no CJS build), which Jest's default
// CJS transform can't parse. Faking the whole module (rather than e.g. spying on
// its prototype) avoids ever loading the real file, while still letting us
// inspect every archive.append(...) call the SUT makes.
const mockAppendCalls: Array<{ data: unknown; name: string }> = [];

jest.mock("archiver", () => {
  class FakeArchiver {
    append(data: unknown, entry: { name: string }) {
      mockAppendCalls.push({ data, name: entry.name });
      return this;
    }
    pipe(dest: { end: () => void }) {
      dest.end();
      return dest;
    }
    finalize() {
      // no-op: pipe() above already ends the destination stream, which is all
      // uploadArchiveToS3 waits on (the destination's "finish" event).
    }
    on() {
      return this;
    }
  }
  return {
    Archiver: FakeArchiver,
    ZipArchive: FakeArchiver,
  };
});

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/services/grantMatchSummaryDocument", () => ({
  getOrGenerateReadyGrantMatchSummary: jest.fn(),
}));

jest.mock("@/backend/services/estimateDocument", () => ({
  getOrGenerateReadyEstimate: jest.fn(),
}));

const mockedUploadStreamToS3 = jest
  .fn<(...args: unknown[]) => Promise<string>>()
  .mockResolvedValue("https://example.com/archive.zip");
const mockedGetObjectBuffer = jest.fn<(...args: unknown[]) => Promise<Buffer>>();

jest.mock("lib/s3", () => ({
  getSignedDownloadUrl: jest.fn(),
  getSignedDownloadUrlFromS3Url: jest.fn(),
  uploadStreamToS3: (...args: unknown[]) => mockedUploadStreamToS3(...args),
  getObjectBuffer: (...args: unknown[]) => mockedGetObjectBuffer(...args),
  deleteObjectFromS3: jest.fn(),
}));

const mockedProjectFindUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockedExportFindUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockedExportUpsert = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockedExportUpdate = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock("lib/prisma", () => ({
  prisma: {
    project: { findUnique: (...args: unknown[]) => mockedProjectFindUnique(...args) },
    manualFallbackExport: {
      findUnique: (...args: unknown[]) => mockedExportFindUnique(...args),
      upsert: (...args: unknown[]) => mockedExportUpsert(...args),
      update: (...args: unknown[]) => mockedExportUpdate(...args),
    },
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { processManualFallbackExport } = require("../manualFallbackExport") as {
  processManualFallbackExport: (
    request: import("../manualFallbackExport").ManualFallbackExportQueuedRequest
  ) => Promise<{ exportRequestId: string }>;
};
const { getOrGenerateReadyGrantMatchSummary } = require("@/backend/services/grantMatchSummaryDocument") as {
  getOrGenerateReadyGrantMatchSummary: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
};
const { getOrGenerateReadyEstimate } = require("@/backend/services/estimateDocument") as {
  getOrGenerateReadyEstimate: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
};

const PROJECT_FIXTURE = {
  id: "project-1",
  address: "123 Main St",
  status: "estimate_accepted",
  grantApplicationStatus: "APPROVED",
  grantDocumentKey: null,
  draftData: {},
  user: { id: "user-1", name: "Jane Client", email: "jane@example.com" },
  quotes: [
    {
      id: "quote-1",
      status: "ACCEPTED",
      subtotal: { toString: () => "500" },
      total: { toString: () => "500" },
      estimateMin: { toString: () => "475" },
      estimateMax: { toString: () => "525" },
      refinedEstimate: null,
      generatedAt: new Date("2026-08-01T00:00:00.000Z"),
      lastClientActivityAt: new Date("2026-08-01T00:00:00.000Z"),
      declinedReason: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    },
  ],
  photos: [],
  grantApplicationStatusHistory: [],
};

function buildRequest(): import("../manualFallbackExport").ManualFallbackExportQueuedRequest {
  return {
    projectId: "project-1",
    requestedByUserId: "user-1",
    requestedByEmail: "jane@example.com",
    requestedByName: "Jane Client",
    exportRequestId: "export-1",
    requestedAt: new Date("2026-08-10T00:00:00.000Z").toISOString(),
    retentionDays: 7,
  };
}

describe("processManualFallbackExport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppendCalls.length = 0;

    mockedProjectFindUnique.mockResolvedValue(PROJECT_FIXTURE);
    mockedExportFindUnique.mockResolvedValue(null);
    mockedExportUpsert.mockResolvedValue({ id: "export-1", retentionDays: 7, maxSizeBytes: null });
    mockedExportUpdate.mockResolvedValue({ id: "export-1", retentionDays: 7, maxSizeBytes: null, status: "READY" });
  });

  it("includes both the Grant Match Summary PDF and the Estimate PDF in the archive", async () => {
    getOrGenerateReadyGrantMatchSummary.mockResolvedValue({
      s3Key: "projects/project-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
    });
    getOrGenerateReadyEstimate.mockResolvedValue({
      s3Key: "projects/project-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
    });
    mockedGetObjectBuffer.mockImplementation(async (...args: unknown[]) => {
      const key = args[0] as string;
      if (key.includes("grant-match-summary")) return Buffer.from("grant-summary-bytes");
      if (key.includes("estimate")) return Buffer.from("estimate-bytes");
      throw new Error(`unexpected key ${key}`);
    });

    await processManualFallbackExport(buildRequest());

    expect(getOrGenerateReadyGrantMatchSummary).toHaveBeenCalledWith("project-1", "user-1");
    expect(getOrGenerateReadyEstimate).toHaveBeenCalledWith("quote-1", "user-1");

    const names = mockAppendCalls.map((call) => call.name);
    expect(names).toEqual(expect.arrayContaining(["grant-match-summary.pdf", "estimate.pdf"]));

    const grantSummaryCall = mockAppendCalls.find((call) => call.name === "grant-match-summary.pdf");
    expect(grantSummaryCall?.data).toEqual(Buffer.from("grant-summary-bytes"));

    const estimateCall = mockAppendCalls.find((call) => call.name === "estimate.pdf");
    expect(estimateCall?.data).toEqual(Buffer.from("estimate-bytes"));
  });

  it("omits either PDF (without failing the export) when its document isn't available", async () => {
    getOrGenerateReadyGrantMatchSummary.mockResolvedValue(null);
    getOrGenerateReadyEstimate.mockResolvedValue(null);

    const result = await processManualFallbackExport(buildRequest());

    expect(result.exportRequestId).toBe("export-1");
    expect(mockedGetObjectBuffer).not.toHaveBeenCalled();

    const names = mockAppendCalls.map((call) => call.name);
    expect(names).not.toContain("grant-match-summary.pdf");
    expect(names).not.toContain("estimate.pdf");
  });

  it("scopes the Estimate PDF lookup to the most recently updated quote when a project has several", async () => {
    mockedProjectFindUnique.mockResolvedValue({
      ...PROJECT_FIXTURE,
      quotes: [
        { ...PROJECT_FIXTURE.quotes[0], id: "quote-newest", updatedAt: new Date("2026-08-05T00:00:00.000Z") },
        { ...PROJECT_FIXTURE.quotes[0], id: "quote-older", updatedAt: new Date("2026-08-01T00:00:00.000Z") },
      ],
    });
    getOrGenerateReadyGrantMatchSummary.mockResolvedValue(null);
    getOrGenerateReadyEstimate.mockResolvedValue(null);

    await processManualFallbackExport(buildRequest());

    expect(getOrGenerateReadyEstimate).toHaveBeenCalledWith("quote-newest", "user-1");
    expect(getOrGenerateReadyEstimate).not.toHaveBeenCalledWith("quote-older", expect.anything());
  });
});
