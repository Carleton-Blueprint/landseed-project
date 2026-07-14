import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: {
    project: {
      findUnique: jest.Mock;
    };
  };
};

const { assembleGrantPdfInput } = require("../grantPdfAssembler") as {
  assembleGrantPdfInput: (projectId: string) => Promise<{
    applicantName: string;
    applicantEmail: string;
    applicantPhone?: string | null;
    projectAddress: string;
    projectId: string;
    grantProgramName: string;
    modificationItems: string[];
    estimatedCost?: string | null;
    ownershipStatus: string;
    incompleteFields: string[];
    preparedAtIso: string;
  }>;
};

function decimal(value: number) {
  return { toNumber: () => value };
}

describe("assembleGrantPdfInput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("assembles all fields from user, draft, and quote data with no incomplete fields", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "456 Fallback Rd",
      draftData: {
        addressLine1: "123 Main St",
        city: "Toronto",
        province: "ON",
        postalCode: "M5V 2T6",
        ownershipStatus: "owner",
        modificationItems: ["Ramp installation", "Grab bars"],
      },
      userId: "user-1",
      user: { name: "Sam Applicant", email: "sam@example.com", phone: "555-1234" },
      quotes: [{ estimateMin: decimal(1000), estimateMax: decimal(2000) }],
      eligibilityAssessments: [
        {
          overallDecision: "ELIGIBLE",
          discoveredGrants: [{ title: "Home Accessibility Grant" }],
        },
      ],
    });

    const result = await assembleGrantPdfInput("proj-1");

    expect(result).toMatchObject({
      applicantName: "Sam Applicant",
      applicantEmail: "sam@example.com",
      applicantPhone: "555-1234",
      projectAddress: "123 Main St, Toronto, ON, M5V 2T6",
      ownershipStatus: "Owner",
      modificationItems: ["Ramp installation", "Grab bars"],
      estimatedCost: "$1,000 – $2,000",
      grantProgramName: "Home Accessibility Grant",
      incompleteFields: [],
    });
  });

  it("falls back to project.address when no draft address fields are present", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-2",
      address: "456 Fallback Rd",
      draftData: {},
      userId: "user-2",
      user: { name: "Sam Applicant", email: "sam@example.com", phone: null },
      quotes: [],
      eligibilityAssessments: [],
    });

    const result = await assembleGrantPdfInput("proj-2");

    expect(result.projectAddress).toBe("456 Fallback Rd");
  });

  it("marks missing fields as [Incomplete] and records them, never throwing", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-3",
      address: null,
      draftData: {},
      userId: "user-3",
      user: { name: null, email: null, phone: null },
      quotes: [],
      eligibilityAssessments: [],
    });

    const result = await assembleGrantPdfInput("proj-3");

    expect(result.applicantName).toBe("[Incomplete]");
    expect(result.applicantEmail).toBe("[Incomplete]");
    expect(result.applicantPhone).toBeNull();
    expect(result.projectAddress).toBe("[Incomplete]");
    expect(result.ownershipStatus).toBe("[Incomplete]");
    expect(result.estimatedCost).toBeNull();
    expect(result.incompleteFields).toEqual(
      expect.arrayContaining([
        "client name",
        "client email",
        "client phone",
        "project address",
        "property ownership status",
        "modification type",
        "estimated cost",
      ])
    );
  });

  it("falls back to draftData name/email/phone when the user record has none", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-4",
      address: null,
      draftData: { name: "Draft Name", email: "draft@example.com", phone: "555-0000" },
      userId: "user-4",
      user: { name: null, email: null, phone: null },
      quotes: [],
      eligibilityAssessments: [],
    });

    const result = await assembleGrantPdfInput("proj-4");

    expect(result.applicantName).toBe("Draft Name");
    expect(result.applicantEmail).toBe("draft@example.com");
    expect(result.applicantPhone).toBe("555-0000");
    expect(result.incompleteFields).not.toEqual(expect.arrayContaining(["client name", "client email", "client phone"]));
  });

  it("maps tenant ownership status and uses a generic program name when not eligible", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-5",
      address: "789 Side St",
      draftData: { ownershipStatus: "tenant", modificationItems: ["Widen doorway"] },
      userId: "user-5",
      user: { name: "Tenant User", email: "tenant@example.com", phone: "555-2222" },
      quotes: [],
      eligibilityAssessments: [{ overallDecision: "INELIGIBLE", discoveredGrants: [] }],
    });

    const result = await assembleGrantPdfInput("proj-5");

    expect(result.ownershipStatus).toBe("Tenant");
    expect(result.grantProgramName).toBe("Landseed Grant Application");
  });

  it("throws when the project does not exist", async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    await expect(assembleGrantPdfInput("missing")).rejects.toThrow("Project not found");
  });
});
