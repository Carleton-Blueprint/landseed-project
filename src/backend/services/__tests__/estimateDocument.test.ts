import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    estimateDocument: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("lib/s3", () => ({
  uploadToS3: jest.fn(),
}));

jest.mock("../estimatePdf", () => ({
  generateEstimatePdf: jest.fn(),
}));

jest.mock("../estimateAssembler", () => ({
  assembleEstimateInput: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

const assembledInput = {
  projectId: "proj-1",
  quoteId: "quote-1",
  clientName: "Sam Applicant",
  projectAddress: "123 Main St",
  modificationType: "Grab Bars",
  selectedTier: null as "economy" | "standard" | "premium" | null,
  pricing: {
    selectedTier: null,
    lineItems: [
      {
        description: "Grab bar install",
        quantity: 2,
        pricingQuery: "grab bar",
        materialUnitCost: 40,
        materialTotal: 80,
        laborHours: 3,
        laborRate: 90,
        laborTotal: 270,
        markupPercentage: 0,
        markupTotal: 0,
        lineTotal: 350,
      },
    ],
    subtotal: 350,
    laborTotal: 270,
    markupTotal: 0,
    total: 350,
    estimateMin: 332.5,
    estimateMax: 367.5,
  },
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
    estimateDocument: {
      findFirst: jest.Mock<(...args: unknown[]) => Promise<DocumentRecord | null>>;
      create: jest.Mock<(...args: unknown[]) => Promise<DocumentRecord>>;
      update: jest.Mock<(...args: unknown[]) => Promise<DocumentRecord>>;
    };
  };
};

const { uploadToS3 } = require("lib/s3") as {
  uploadToS3: jest.Mock<(...args: unknown[]) => Promise<string>>;
};

const { generateEstimatePdf } = require("../estimatePdf") as {
  generateEstimatePdf: jest.Mock<(...args: unknown[]) => Promise<Buffer>>;
};

const { assembleEstimateInput } = require("../estimateAssembler") as {
  assembleEstimateInput: jest.Mock<(...args: unknown[]) => Promise<typeof assembledInput>>;
};

const { logAuditEventNonBlocking } = require("@/backend/audit/log") as {
  logAuditEventNonBlocking: jest.Mock<(...args: unknown[]) => Promise<void>>;
};

const {
  generateAndStoreEstimateDocument,
  getOrGenerateReadyEstimate,
} = require("../estimateDocument") as {
  generateAndStoreEstimateDocument: (input: {
    quoteId: string;
    actorUserId: string;
    force?: boolean;
  }) => Promise<{
    documentId: string;
    projectId: string;
    quoteId: string;
    s3Key: string;
    fileName: string;
    regenerated: boolean;
  }>;
  getOrGenerateReadyEstimate: (
    quoteId: string,
    actorUserId: string
  ) => Promise<{ s3Key: string; fileName: string } | null>;
};

function contentHashFor(input: typeof assembledInput): string {
  const { createHash } = require("crypto");
  const relevantFields = {
    clientName: input.clientName,
    projectAddress: input.projectAddress,
    modificationType: input.modificationType,
    selectedTier: input.selectedTier,
    pricing: input.pricing,
    incompleteFields: input.incompleteFields,
  };
  return createHash("sha256").update(JSON.stringify(relevantFields)).digest("hex");
}

describe("generateAndStoreEstimateDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assembleEstimateInput.mockResolvedValue(assembledInput);
    generateEstimatePdf.mockResolvedValue(Buffer.from("pdf-bytes"));
    uploadToS3.mockResolvedValue("https://example.com/file.pdf");
    prisma.estimateDocument.create.mockResolvedValue({
      id: "doc-new",
      status: "PENDING",
      s3Key: null,
      fileName: null,
      contentHash: null,
      version: 1,
    });
    prisma.estimateDocument.update.mockResolvedValue({
      id: "doc-new",
      status: "READY",
      s3Key: "projects/proj-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
      contentHash: "hash",
      version: 1,
    });
  });

  it("creates and uploads a new document when none exists yet", async () => {
    prisma.estimateDocument.findFirst.mockResolvedValue(null);

    const result = await generateAndStoreEstimateDocument({
      quoteId: "quote-1",
      actorUserId: "user-1",
    });

    expect(generateEstimatePdf).toHaveBeenCalledWith(assembledInput);
    expect(uploadToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      "projects/proj-1/estimate/estimate-v1.pdf",
      "application/pdf"
    );
    expect(prisma.estimateDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1, isLatest: true, status: "PENDING" }) })
    );
    expect(result).toEqual({
      documentId: "doc-new",
      projectId: "proj-1",
      quoteId: "quote-1",
      s3Key: "projects/proj-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
      regenerated: true,
    });
  });

  it("skips regeneration when the latest READY document has an unchanged content hash", async () => {
    const contentHash = contentHashFor(assembledInput);
    prisma.estimateDocument.findFirst.mockResolvedValue({
      id: "doc-existing",
      status: "READY",
      s3Key: "projects/proj-1/estimate/estimate-v2.pdf",
      fileName: "estimate-v2.pdf",
      contentHash,
      version: 2,
    });

    const result = await generateAndStoreEstimateDocument({
      quoteId: "quote-1",
      actorUserId: "user-1",
    });

    expect(generateEstimatePdf).not.toHaveBeenCalled();
    expect(uploadToS3).not.toHaveBeenCalled();
    expect(prisma.estimateDocument.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      documentId: "doc-existing",
      projectId: "proj-1",
      quoteId: "quote-1",
      s3Key: "projects/proj-1/estimate/estimate-v2.pdf",
      fileName: "estimate-v2.pdf",
      regenerated: false,
    });
  });

  it("regenerates with an incremented version when force is set, even with an unchanged hash", async () => {
    const contentHash = contentHashFor(assembledInput);
    prisma.estimateDocument.findFirst.mockResolvedValue({
      id: "doc-existing",
      status: "READY",
      s3Key: "projects/proj-1/estimate/estimate-v2.pdf",
      fileName: "estimate-v2.pdf",
      contentHash,
      version: 2,
    });
    prisma.estimateDocument.create.mockResolvedValue({
      id: "doc-new",
      status: "PENDING",
      s3Key: null,
      fileName: null,
      contentHash: null,
      version: 3,
    });

    const result = await generateAndStoreEstimateDocument({
      quoteId: "quote-1",
      actorUserId: "user-1",
      force: true,
    });

    expect(prisma.estimateDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "doc-existing" }, data: { isLatest: false } })
    );
    expect(uploadToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      "projects/proj-1/estimate/estimate-v3.pdf",
      "application/pdf"
    );
    expect(result.regenerated).toBe(true);
  });

  it("marks the document FAILED and rethrows when upload fails", async () => {
    prisma.estimateDocument.findFirst.mockResolvedValue(null);
    uploadToS3.mockRejectedValue(new Error("S3 unavailable"));

    await expect(
      generateAndStoreEstimateDocument({ quoteId: "quote-1", actorUserId: "user-1" })
    ).rejects.toThrow("S3 unavailable");

    expect(prisma.estimateDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(expect.objectContaining({ outcome: "FAILURE" }));
  });
});

describe("getOrGenerateReadyEstimate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assembleEstimateInput.mockResolvedValue(assembledInput);
    generateEstimatePdf.mockResolvedValue(Buffer.from("pdf-bytes"));
    uploadToS3.mockResolvedValue("https://example.com/file.pdf");
  });

  it("returns the existing READY document without regenerating", async () => {
    prisma.estimateDocument.findFirst.mockResolvedValue({
      id: "doc-existing",
      status: "READY",
      s3Key: "projects/proj-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
      contentHash: "hash",
      version: 1,
    });

    const result = await getOrGenerateReadyEstimate("quote-1", "user-1");

    expect(result).toEqual({
      s3Key: "projects/proj-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
    });
    expect(generateEstimatePdf).not.toHaveBeenCalled();
  });

  it("generates a new document on demand when none is READY yet", async () => {
    prisma.estimateDocument.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.estimateDocument.create.mockResolvedValue({
      id: "doc-new",
      status: "PENDING",
      s3Key: null,
      fileName: null,
      contentHash: null,
      version: 1,
    });
    prisma.estimateDocument.update.mockResolvedValue({
      id: "doc-new",
      status: "READY",
      s3Key: "projects/proj-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
      contentHash: "hash",
      version: 1,
    });

    const result = await getOrGenerateReadyEstimate("quote-1", "user-1");

    expect(result).toEqual({
      s3Key: "projects/proj-1/estimate/estimate-v1.pdf",
      fileName: "estimate-v1.pdf",
    });
    expect(generateEstimatePdf).toHaveBeenCalled();
  });

  it("returns null when on-demand generation fails", async () => {
    prisma.estimateDocument.findFirst.mockResolvedValue(null);
    prisma.estimateDocument.create.mockResolvedValue({
      id: "doc-new",
      status: "PENDING",
      s3Key: null,
      fileName: null,
      contentHash: null,
      version: 1,
    });
    uploadToS3.mockRejectedValue(new Error("S3 unavailable"));

    const result = await getOrGenerateReadyEstimate("quote-1", "user-1");

    expect(result).toBeNull();
  });
});
