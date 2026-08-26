import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    grantMatchSummaryDocument: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("lib/s3", () => ({
  uploadToS3: jest.fn(),
}));

jest.mock("../grantMatchSummaryPdf", () => ({
  generateGrantMatchSummaryPdf: jest.fn(),
}));

jest.mock("../grantMatchSummaryAssembler", () => ({
  assembleGrantMatchSummaryInput: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

const assembledInput = {
  projectId: "proj-1",
  eligibilityAssessmentId: "assess-1",
  clientName: "Sam Applicant",
  projectAddress: "123 Main St",
  modificationType: "Grab Bars",
  assessmentDate: "2026-08-20T12:00:00.000Z",
  outputSource: "LIVE" as const,
  matchedGrants: [
    {
      programName: "Home Accessibility Tax Credit",
      eligibilityStatus: "ELIGIBLE" as const,
      confidence: "HIGH" as const,
      estimatedFunding: "Up to $20,000",
      scopeDescription: "Federal tax credit.",
    },
  ],
  hasMatches: true,
  incompleteFields: [] as string[],
  preparedAtIso: new Date().toISOString(),
};

type DocumentRecord = {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  s3Key: string | null;
  fileName: string | null;
  contentHash: string | null;
  version: number;
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: {
    grantMatchSummaryDocument: {
      findFirst: jest.Mock<(...args: unknown[]) => Promise<DocumentRecord | null>>;
      create: jest.Mock<(...args: unknown[]) => Promise<DocumentRecord>>;
      update: jest.Mock<(...args: unknown[]) => Promise<DocumentRecord>>;
    };
  };
};

const { uploadToS3 } = require("lib/s3") as {
  uploadToS3: jest.Mock<(...args: unknown[]) => Promise<string>>;
};

const { generateGrantMatchSummaryPdf } = require("../grantMatchSummaryPdf") as {
  generateGrantMatchSummaryPdf: jest.Mock<(...args: unknown[]) => Promise<Buffer>>;
};

const { assembleGrantMatchSummaryInput } = require("../grantMatchSummaryAssembler") as {
  assembleGrantMatchSummaryInput: jest.Mock<(...args: unknown[]) => Promise<typeof assembledInput>>;
};

const { logAuditEventNonBlocking } = require("@/backend/audit/log") as {
  logAuditEventNonBlocking: jest.Mock<(...args: unknown[]) => Promise<void>>;
};

const {
  generateAndStoreGrantMatchSummaryDocument,
  getOrGenerateReadyGrantMatchSummary,
} = require("../grantMatchSummaryDocument") as {
  generateAndStoreGrantMatchSummaryDocument: (input: {
    projectId: string;
    actorUserId: string;
    force?: boolean;
  }) => Promise<{
    documentId: string;
    projectId: string;
    s3Key: string;
    fileName: string;
    regenerated: boolean;
  }>;
  getOrGenerateReadyGrantMatchSummary: (
    projectId: string,
    actorUserId: string
  ) => Promise<{ s3Key: string; fileName: string } | null>;
};

function contentHashFor(input: typeof assembledInput): string {
  const { createHash } = require("crypto");
  const relevantFields = {
    clientName: input.clientName,
    projectAddress: input.projectAddress,
    modificationType: input.modificationType,
    assessmentDate: input.assessmentDate,
    outputSource: input.outputSource,
    matchedGrants: input.matchedGrants,
    hasMatches: input.hasMatches,
    incompleteFields: input.incompleteFields,
  };
  return createHash("sha256").update(JSON.stringify(relevantFields)).digest("hex");
}

describe("generateAndStoreGrantMatchSummaryDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assembleGrantMatchSummaryInput.mockResolvedValue(assembledInput);
    generateGrantMatchSummaryPdf.mockResolvedValue(Buffer.from("pdf-bytes"));
    uploadToS3.mockResolvedValue("https://example.com/file.pdf");
    prisma.grantMatchSummaryDocument.create.mockResolvedValue({
      id: "doc-new",
      status: "PENDING",
      s3Key: null,
      fileName: null,
      contentHash: null,
      version: 1,
    });
    prisma.grantMatchSummaryDocument.update.mockResolvedValue({
      id: "doc-new",
      status: "READY",
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
      contentHash: "hash",
      version: 1,
    });
  });

  it("creates and uploads a new document when none exists yet", async () => {
    prisma.grantMatchSummaryDocument.findFirst.mockResolvedValue(null);

    const result = await generateAndStoreGrantMatchSummaryDocument({
      projectId: "proj-1",
      actorUserId: "user-1",
    });

    expect(generateGrantMatchSummaryPdf).toHaveBeenCalledWith(assembledInput);
    expect(uploadToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      "projects/proj-1/grant-match-summary/grant-match-summary-v1.pdf",
      "application/pdf"
    );
    expect(prisma.grantMatchSummaryDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1, isLatest: true, status: "PENDING" }) })
    );
    expect(result).toEqual({
      documentId: "doc-new",
      projectId: "proj-1",
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
      regenerated: true,
    });
  });

  it("skips regeneration when the latest READY document has an unchanged content hash", async () => {
    const contentHash = contentHashFor(assembledInput);
    prisma.grantMatchSummaryDocument.findFirst.mockResolvedValue({
      id: "doc-existing",
      status: "READY",
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v2.pdf",
      fileName: "grant-match-summary-v2.pdf",
      contentHash,
      version: 2,
    });

    const result = await generateAndStoreGrantMatchSummaryDocument({
      projectId: "proj-1",
      actorUserId: "user-1",
    });

    expect(generateGrantMatchSummaryPdf).not.toHaveBeenCalled();
    expect(uploadToS3).not.toHaveBeenCalled();
    expect(prisma.grantMatchSummaryDocument.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      documentId: "doc-existing",
      projectId: "proj-1",
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v2.pdf",
      fileName: "grant-match-summary-v2.pdf",
      regenerated: false,
    });
  });

  it("regenerates with an incremented version when force is set, even with an unchanged hash", async () => {
    const contentHash = contentHashFor(assembledInput);
    prisma.grantMatchSummaryDocument.findFirst.mockResolvedValue({
      id: "doc-existing",
      status: "READY",
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v2.pdf",
      fileName: "grant-match-summary-v2.pdf",
      contentHash,
      version: 2,
    });
    prisma.grantMatchSummaryDocument.create.mockResolvedValue({
      id: "doc-new",
      status: "PENDING",
      s3Key: null,
      fileName: null,
      contentHash: null,
      version: 3,
    });

    const result = await generateAndStoreGrantMatchSummaryDocument({
      projectId: "proj-1",
      actorUserId: "user-1",
      force: true,
    });

    expect(prisma.grantMatchSummaryDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "doc-existing" }, data: { isLatest: false } })
    );
    expect(uploadToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      "projects/proj-1/grant-match-summary/grant-match-summary-v3.pdf",
      "application/pdf"
    );
    expect(result.regenerated).toBe(true);
  });

  it("marks the document FAILED and rethrows when upload fails", async () => {
    prisma.grantMatchSummaryDocument.findFirst.mockResolvedValue(null);
    uploadToS3.mockRejectedValue(new Error("S3 unavailable"));

    await expect(
      generateAndStoreGrantMatchSummaryDocument({ projectId: "proj-1", actorUserId: "user-1" })
    ).rejects.toThrow("S3 unavailable");

    expect(prisma.grantMatchSummaryDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(expect.objectContaining({ outcome: "FAILURE" }));
  });
});

describe("getOrGenerateReadyGrantMatchSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assembleGrantMatchSummaryInput.mockResolvedValue(assembledInput);
    generateGrantMatchSummaryPdf.mockResolvedValue(Buffer.from("pdf-bytes"));
    uploadToS3.mockResolvedValue("https://example.com/file.pdf");
  });

  it("returns the existing READY document without regenerating", async () => {
    prisma.grantMatchSummaryDocument.findFirst.mockResolvedValue({
      id: "doc-existing",
      status: "READY",
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
      contentHash: "hash",
      version: 1,
    });

    const result = await getOrGenerateReadyGrantMatchSummary("proj-1", "user-1");

    expect(result).toEqual({
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
    });
    expect(generateGrantMatchSummaryPdf).not.toHaveBeenCalled();
  });

  it("generates a new document on demand when none is READY yet", async () => {
    prisma.grantMatchSummaryDocument.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.grantMatchSummaryDocument.create.mockResolvedValue({
      id: "doc-new",
      status: "PENDING",
      s3Key: null,
      fileName: null,
      contentHash: null,
      version: 1,
    });
    prisma.grantMatchSummaryDocument.update.mockResolvedValue({
      id: "doc-new",
      status: "READY",
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
      contentHash: "hash",
      version: 1,
    });

    const result = await getOrGenerateReadyGrantMatchSummary("proj-1", "user-1");

    expect(result).toEqual({
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v1.pdf",
      fileName: "grant-match-summary-v1.pdf",
    });
    expect(generateGrantMatchSummaryPdf).toHaveBeenCalled();
  });

  it("returns null when on-demand generation fails", async () => {
    prisma.grantMatchSummaryDocument.findFirst.mockResolvedValue(null);
    prisma.grantMatchSummaryDocument.create.mockResolvedValue({
      id: "doc-new",
      status: "PENDING",
      s3Key: null,
      fileName: null,
      contentHash: null,
      version: 1,
    });
    uploadToS3.mockRejectedValue(new Error("S3 unavailable"));

    const result = await getOrGenerateReadyGrantMatchSummary("proj-1", "user-1");

    expect(result).toBeNull();
  });
});
