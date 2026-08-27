import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
  },
}));

type ProjectPdfRecord = {
  id: string;
  address: string | null;
  draftData: unknown;
  userId: string;
  photos: Array<{ declaredModificationCodes: string[] }>;
  user: { name: string | null; email: string | null; phone: string | null };
  quotes: Array<{
    estimateMin: { toNumber(): number } | null;
    estimateMax: { toNumber(): number } | null;
    total?: number;
    eligibilityAssessmentId?: string | null;
    override?: { eligibilityDecision: string; total: number; grantOverrides: unknown } | null;
  }>;
  eligibilityAssessments: Array<{ id?: string; overallDecision: string; discoveredGrants: unknown }>;
  manualModeSubmission?: { modificationType: string | null } | null;
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: {
    project: {
      findUnique: jest.Mock<(...args: unknown[]) => Promise<ProjectPdfRecord | null>>;
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
      },
      userId: "user-1",
      photos: [{ declaredModificationCodes: ["GRAB_BARS", "WIDENED_DOORWAY"] }],
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
      modificationItems: ["Grab Bars", "Widened Doorway"],
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
      photos: [],
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
      photos: [],
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
      photos: [],
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

  it("maps tenant ownership status and names the zero-matches case explicitly when ineligible", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-5",
      address: "789 Side St",
      draftData: { ownershipStatus: "tenant" },
      userId: "user-5",
      photos: [{ declaredModificationCodes: ["WIDENED_DOORWAY"] }],
      user: { name: "Tenant User", email: "tenant@example.com", phone: "555-2222" },
      quotes: [],
      eligibilityAssessments: [{ overallDecision: "INELIGIBLE", discoveredGrants: [] }],
    });

    const result = await assembleGrantPdfInput("proj-5");

    expect(result.ownershipStatus).toBe("Tenant");
    expect(result.grantProgramName).toBe("No matching grants found");
  });

  it("uses a generic program name when there is no final eligibility decision yet", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-6",
      address: "1 Pending Ave",
      draftData: { ownershipStatus: "owner", modificationItems: ["Grab bars"] },
      userId: "user-6",
      photos: [],
      user: { name: "Pending User", email: "pending@example.com", phone: "555-3333" },
      quotes: [],
      eligibilityAssessments: [{ overallDecision: "NEEDS_MORE_INFO", discoveredGrants: [] }],
    });

    const result = await assembleGrantPdfInput("proj-6");

    expect(result.grantProgramName).toBe("Landseed Grant Application");
  });

  it("falls back to the manual-mode submission's modification type when no photos are tagged", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-6",
      address: "1 Manual Mode Way",
      draftData: {},
      userId: "user-6",
      photos: [],
      user: { name: "Manual User", email: "manual@example.com", phone: "555-3333" },
      quotes: [],
      eligibilityAssessments: [],
      manualModeSubmission: { modificationType: "Custom stair lift install" },
    });

    const result = await assembleGrantPdfInput("proj-6");

    expect(result.modificationItems).toEqual(["Custom stair lift install"]);
    expect(result.incompleteFields).not.toContain("modification type");
  });

  it("shows a single overridden total instead of the AI estimate range, and the overridden grant program", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-7",
      address: "10 Override Ln",
      draftData: { ownershipStatus: "owner" },
      userId: "user-7",
      photos: [{ declaredModificationCodes: ["GRAB_BARS"] }],
      user: { name: "Override User", email: "override@example.com", phone: "555-4444" },
      quotes: [
        {
          estimateMin: decimal(1000),
          estimateMax: decimal(2000),
          eligibilityAssessmentId: "assess-7",
          override: {
            eligibilityDecision: "ELIGIBLE",
            total: 1500,
            grantOverrides: {
              removedGrantIds: ["hatc_canada"],
              decisionOverrides: [],
              addedGrants: [
                { id: "manual-1", title: "Manual Grant", scope: "MUNICIPAL", jurisdiction: "Toronto", decision: "ELIGIBLE", note: "Confirmed by phone" },
              ],
            },
          },
        },
      ],
      eligibilityAssessments: [
        {
          id: "assess-7",
          overallDecision: "NEEDS_MORE_INFO",
          discoveredGrants: [{ grantId: "hatc_canada", title: "Home Accessibility Grant" }],
        },
      ],
    });

    const result = await assembleGrantPdfInput("proj-7");

    expect(result.estimatedCost).toBe("$1,500");
    expect(result.grantProgramName).toBe("Manual Grant");
  });

  it("ignores the override when the quote points at a different (stale) assessment", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-8",
      address: "20 Stale Ln",
      draftData: { ownershipStatus: "owner" },
      userId: "user-8",
      photos: [{ declaredModificationCodes: ["GRAB_BARS"] }],
      user: { name: "Stale User", email: "stale@example.com", phone: "555-5555" },
      quotes: [
        {
          estimateMin: decimal(1000),
          estimateMax: decimal(2000),
          eligibilityAssessmentId: "assess-8-old",
          override: { eligibilityDecision: "INELIGIBLE", total: 1500, grantOverrides: null },
        },
      ],
      eligibilityAssessments: [
        { id: "assess-8-new", overallDecision: "ELIGIBLE", discoveredGrants: [{ title: "Home Accessibility Grant" }] },
      ],
    });

    const result = await assembleGrantPdfInput("proj-8");

    expect(result.estimatedCost).toBe("$1,000 – $2,000");
    expect(result.grantProgramName).toBe("Home Accessibility Grant");
  });

  it("throws when the project does not exist", async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    await expect(assembleGrantPdfInput("missing")).rejects.toThrow("Project not found");
  });
});
