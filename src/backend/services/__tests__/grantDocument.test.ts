import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditEvent: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("lib/s3", () => ({
  uploadToS3: jest.fn(),
}));

jest.mock("@/backend/services/pdf", () => ({
  generateGrantPdf: jest.fn(),
}));

jest.mock("../grantTemplateFill", () => ({
  fillGrantTemplate: jest.fn(),
}));

jest.mock("@/backend/services/grantPdfAssembler", () => ({
  assembleGrantPdfInput: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: {
    project: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    auditEvent: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
  };
};

const { uploadToS3 } = require("lib/s3") as {
  uploadToS3: jest.Mock;
};

const { generateGrantPdf } = require("@/backend/services/pdf") as {
  generateGrantPdf: jest.Mock;
};

const { fillGrantTemplate } = require("../grantTemplateFill") as {
  fillGrantTemplate: jest.Mock;
};

const { assembleGrantPdfInput } = require("@/backend/services/grantPdfAssembler") as {
  assembleGrantPdfInput: jest.Mock;
};

const { logAuditEventNonBlocking } = require("@/backend/audit/log") as {
  logAuditEventNonBlocking: jest.Mock;
};

const {
  generateAndStoreGrantDocument,
  getLatestGrantDocumentGenerationInfo,
} = require("../grantDocument") as {
  generateAndStoreGrantDocument: (input: {
    projectId: string;
    actorUserId: string;
    force?: boolean;
  }) => Promise<{
    projectId: string;
    grantDocumentKey: string;
    previousGrantDocumentKey: string | null;
    regenerated: boolean;
  }>;
  getLatestGrantDocumentGenerationInfo: (
    projectId: string
  ) => Promise<{ generatedAt: Date; incompleteFields: string[] } | null>;
};

const assembledInput = {
  applicantName: "Sam Applicant",
  applicantEmail: "sam@example.com",
  applicantPhone: "555-9999",
  projectAddress: "123 Main St",
  projectId: "proj-1",
  grantProgramName: "Landseed Grant",
  modificationItems: ["Door widening", "Lift install"],
  estimatedCost: "$1,000 – $2,000",
  ownershipStatus: "Owner",
  incompleteFields: [] as string[],
  preparedAtIso: new Date().toISOString(),
};

describe("generateAndStoreGrantDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assembleGrantPdfInput.mockResolvedValue(assembledInput);
    fillGrantTemplate.mockResolvedValue(Buffer.from("template-pdf"));
    generateGrantPdf.mockResolvedValue(Buffer.from("generic-pdf"));
    uploadToS3.mockResolvedValue("https://example.com/file.pdf");
    prisma.project.update.mockResolvedValue({ id: "proj-1" });
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.auditEvent.findMany.mockResolvedValue([]);
  });

  it("fills the template PDF and uploads it when there is no prior document", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "123 Main St",
      grantDocumentKey: null,
      user: { name: "Sam Applicant", email: "sam@example.com", phone: "555-9999" },
    });

    const result = await generateAndStoreGrantDocument({ projectId: "proj-1", actorUserId: "user-1" });

    expect(fillGrantTemplate).toHaveBeenCalledWith(assembledInput);
    expect(generateGrantPdf).not.toHaveBeenCalled();
    expect(uploadToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      "projects/proj-1/grant/grant-application-v1.pdf",
      "application/pdf"
    );
    expect(result).toEqual({
      projectId: "proj-1",
      grantDocumentKey: "projects/proj-1/grant/grant-application-v1.pdf",
      previousGrantDocumentKey: null,
      regenerated: true,
    });
  });

  it("falls back to the generic PDF generator when template filling fails", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "123 Main St",
      grantDocumentKey: null,
      user: { name: "Sam Applicant", email: "sam@example.com", phone: "555-9999" },
    });
    fillGrantTemplate.mockRejectedValue(new Error("template asset missing"));

    const result = await generateAndStoreGrantDocument({ projectId: "proj-1", actorUserId: "user-1" });

    expect(fillGrantTemplate).toHaveBeenCalled();
    expect(generateGrantPdf).toHaveBeenCalledWith(
      expect.objectContaining({ applicantName: "Sam Applicant", incompleteFields: [] })
    );
    expect(uploadToS3).toHaveBeenCalled();
    expect(result.regenerated).toBe(true);
  });

  it("skips regeneration when no relevant fields changed since the last version", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "123 Main St",
      grantDocumentKey: "projects/proj-1/grant/grant-application-v2.pdf",
      user: { name: "Sam Applicant", email: "sam@example.com", phone: "555-9999" },
    });

    const relevantFields = {
      applicantName: assembledInput.applicantName,
      applicantEmail: assembledInput.applicantEmail,
      applicantPhone: assembledInput.applicantPhone,
      projectAddress: assembledInput.projectAddress,
      projectId: assembledInput.projectId,
      grantProgramName: assembledInput.grantProgramName,
      modificationItems: assembledInput.modificationItems,
      estimatedCost: assembledInput.estimatedCost,
      ownershipStatus: assembledInput.ownershipStatus,
      incompleteFields: assembledInput.incompleteFields,
    };
    const { createHash } = require("crypto");
    const contentHash = createHash("sha256").update(JSON.stringify(relevantFields)).digest("hex");
    prisma.auditEvent.findFirst.mockResolvedValue({ metadata: { contentHash } });

    const result = await generateAndStoreGrantDocument({ projectId: "proj-1", actorUserId: "user-1" });

    expect(fillGrantTemplate).not.toHaveBeenCalled();
    expect(generateGrantPdf).not.toHaveBeenCalled();
    expect(uploadToS3).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      projectId: "proj-1",
      grantDocumentKey: "projects/proj-1/grant/grant-application-v2.pdf",
      previousGrantDocumentKey: "projects/proj-1/grant/grant-application-v2.pdf",
      regenerated: false,
    });
  });

  it("regenerates even with an unchanged fingerprint when force is set", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "123 Main St",
      grantDocumentKey: "projects/proj-1/grant/grant-application-v2.pdf",
      user: { name: "Sam Applicant", email: "sam@example.com", phone: "555-9999" },
    });
    prisma.auditEvent.findFirst.mockResolvedValue({ metadata: { contentHash: "irrelevant" } });

    const result = await generateAndStoreGrantDocument({
      projectId: "proj-1",
      actorUserId: "user-1",
      force: true,
    });

    expect(fillGrantTemplate).toHaveBeenCalled();
    expect(uploadToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      "projects/proj-1/grant/grant-application-v3.pdf",
      "application/pdf"
    );
    expect(result.regenerated).toBe(true);
  });

  it("throws when project does not exist", async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    await expect(
      generateAndStoreGrantDocument({ projectId: "missing-project", actorUserId: "user-1" })
    ).rejects.toThrow("Project not found");

    expect(uploadToS3).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("logs a FAILURE audit event and rethrows when upload fails", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "123 Main St",
      grantDocumentKey: null,
      user: { name: "Sam Applicant", email: "sam@example.com", phone: "555-9999" },
    });
    uploadToS3.mockRejectedValue(new Error("S3 unavailable"));

    await expect(
      generateAndStoreGrantDocument({ projectId: "proj-1", actorUserId: "user-1" })
    ).rejects.toThrow("S3 unavailable");

    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "FAILURE" })
    );
  });
});

describe("getLatestGrantDocumentGenerationInfo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when there is no prior successful generation", async () => {
    prisma.auditEvent.findMany.mockResolvedValue([]);
    const result = await getLatestGrantDocumentGenerationInfo("proj-1");
    expect(result).toBeNull();
  });

  it("skips skip-events and returns the most recent event that actually wrote a file", async () => {
    prisma.auditEvent.findMany.mockResolvedValue([
      { createdAt: new Date("2026-07-08T00:00:00Z"), metadata: { skipped: true } },
      {
        createdAt: new Date("2026-07-01T00:00:00Z"),
        metadata: { generator: "template", incompleteFields: ["client phone"] },
      },
    ]);

    const result = await getLatestGrantDocumentGenerationInfo("proj-1");

    expect(result).toEqual({
      generatedAt: new Date("2026-07-01T00:00:00Z"),
      incompleteFields: ["client phone"],
    });
  });
});
