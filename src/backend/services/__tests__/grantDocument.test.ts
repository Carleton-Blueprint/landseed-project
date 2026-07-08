import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("lib/s3", () => ({
  uploadToS3: jest.fn(),
}));

jest.mock("@/backend/services/pdf", () => ({
  generateGrantPdf: jest.fn(),
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
  };
};

const { uploadToS3 } = require("lib/s3") as {
  uploadToS3: jest.Mock;
};

const { generateGrantPdf } = require("@/backend/services/pdf") as {
  generateGrantPdf: jest.Mock;
};

const { assembleGrantPdfInput } = require("@/backend/services/grantPdfAssembler") as {
  assembleGrantPdfInput: jest.Mock;
};

const { logAuditEventNonBlocking } = require("@/backend/audit/log") as {
  logAuditEventNonBlocking: jest.Mock;
};

const { generateAndStoreGrantDocument } = require("../grantDocument") as {
  generateAndStoreGrantDocument: (input: {
    projectId: string;
    actorUserId: string;
  }) => Promise<{
    projectId: string;
    grantDocumentKey: string;
    previousGrantDocumentKey: string | null;
  }>;
};

describe("generateAndStoreGrantDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("generates PDF, uploads to S3, and updates grantDocumentKey", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "123 Main St",
      grantDocumentKey: "projects/proj-1/grant/grant-application-v2.pdf",
      user: {
        name: "Sam Applicant",
        email: "sam@example.com",
        phone: "555-9999",
      },
    });

    assembleGrantPdfInput.mockResolvedValue({
      applicantName: "Sam Applicant",
      applicantEmail: "sam@example.com",
      applicantPhone: "555-9999",
      projectAddress: "123 Main St",
      projectId: "proj-1",
      grantProgramName: "Landseed Grant",
      modificationItems: ["Door widening", "Lift install"],
      estimatedCost: "$1,000 – $2,000",
      ownershipStatus: "Owner",
      incompleteFields: [],
      preparedAtIso: new Date().toISOString(),
    });

    generateGrantPdf.mockResolvedValue(Buffer.from("pdf"));
    uploadToS3.mockResolvedValue("https://example.com/file.pdf");
    prisma.project.update.mockResolvedValue({ id: "proj-1" });

    const result = await generateAndStoreGrantDocument({
      projectId: "proj-1",
      actorUserId: "user-1",
    });

    expect(assembleGrantPdfInput).toHaveBeenCalledWith("proj-1");

    expect(generateGrantPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        projectAddress: "123 Main St",
        applicantName: "Sam Applicant",
        applicantEmail: "sam@example.com",
        incompleteFields: [],
      })
    );

    expect(uploadToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      "projects/proj-1/grant/grant-application-v3.pdf",
      "application/pdf"
    );

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: {
        grantDocumentKey: "projects/proj-1/grant/grant-application-v3.pdf",
      },
    });

    expect(result).toEqual({
      projectId: "proj-1",
      grantDocumentKey: "projects/proj-1/grant/grant-application-v3.pdf",
      previousGrantDocumentKey: "projects/proj-1/grant/grant-application-v2.pdf",
    });

    expect(logAuditEventNonBlocking).toHaveBeenCalled();
  });

  it("passes incompleteFields through to the PDF generator so missing data is never fatal", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-2",
      address: null,
      grantDocumentKey: null,
      user: { name: null, email: null, phone: null },
    });

    assembleGrantPdfInput.mockResolvedValue({
      applicantName: "[Incomplete]",
      applicantEmail: "[Incomplete]",
      applicantPhone: null,
      projectAddress: "[Incomplete]",
      projectId: "proj-2",
      grantProgramName: "Landseed Grant Application",
      modificationItems: [],
      estimatedCost: null,
      ownershipStatus: "[Incomplete]",
      incompleteFields: ["client name", "client email", "project address", "property ownership status", "estimated cost"],
      preparedAtIso: new Date().toISOString(),
    });

    generateGrantPdf.mockResolvedValue(Buffer.from("pdf"));
    uploadToS3.mockResolvedValue("https://example.com/file.pdf");
    prisma.project.update.mockResolvedValue({ id: "proj-2" });

    const result = await generateAndStoreGrantDocument({
      projectId: "proj-2",
      actorUserId: "system",
    });

    expect(generateGrantPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        incompleteFields: ["client name", "client email", "project address", "property ownership status", "estimated cost"],
      })
    );
    expect(result.grantDocumentKey).toContain("projects/proj-2/grant/grant-application-v1.pdf");
  });

  it("throws when project does not exist", async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    await expect(
      generateAndStoreGrantDocument({
        projectId: "missing-project",
        actorUserId: "user-1",
      })
    ).rejects.toThrow("Project not found");

    expect(uploadToS3).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});
