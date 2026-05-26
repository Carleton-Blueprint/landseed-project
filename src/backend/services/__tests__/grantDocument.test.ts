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
  const mockedPrisma = prisma;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("generates PDF, uploads to S3, and updates grantDocumentKey", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "123 Main St",
      grantDocumentKey: "projects/proj-1/grant/grant-application-v2.pdf",
      draftData: {
        modificationItems: ["Door widening", "Lift install"],
      },
      user: {
        name: "Sam Applicant",
        email: "sam@example.com",
        phone: "555-9999",
      },
    });

    generateGrantPdf.mockResolvedValue(Buffer.from("pdf"));
    uploadToS3.mockResolvedValue("https://example.com/file.pdf");
    mockedPrisma.project.update.mockResolvedValue({ id: "proj-1" });

    const result = await generateAndStoreGrantDocument({
      projectId: "proj-1",
      actorUserId: "user-1",
    });

    expect(generateGrantPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        projectAddress: "123 Main St",
        applicantName: "Sam Applicant",
        applicantEmail: "sam@example.com",
      })
    );

    expect(uploadToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      "projects/proj-1/grant/grant-application-v3.pdf",
      "application/pdf"
    );

    expect(mockedPrisma.project.update).toHaveBeenCalledWith({
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

  it("throws when project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    await expect(
      generateAndStoreGrantDocument({
        projectId: "missing-project",
        actorUserId: "user-1",
      })
    ).rejects.toThrow("Project not found");

    expect(uploadToS3).not.toHaveBeenCalled();
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });
});