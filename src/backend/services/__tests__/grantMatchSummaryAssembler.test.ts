import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
  },
}));

type ProjectSummaryRecord = {
  id: string;
  address: string | null;
  draftData: unknown;
  photos: Array<{ declaredModificationCodes: string[] }>;
  user: { name: string | null };
  manualModeSubmission?: { modificationType: string | null } | null;
  eligibilityAssessments: Array<{
    id: string;
    createdAt: Date;
    discoveredGrants: unknown;
    discoveryProvider: string | null;
  }>;
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: {
    project: {
      findUnique: jest.Mock<(...args: unknown[]) => Promise<ProjectSummaryRecord | null>>;
    };
  };
};

const { assembleGrantMatchSummaryInput } = require("../grantMatchSummaryAssembler") as {
  assembleGrantMatchSummaryInput: (projectId: string) => Promise<{
    projectId: string;
    eligibilityAssessmentId: string;
    clientName: string;
    projectAddress: string;
    modificationType: string;
    assessmentDate: string;
    outputSource: string;
    matchedGrants: Array<{
      programName: string;
      eligibilityStatus: string;
      confidence: string;
      estimatedFunding: string | null;
      scopeDescription: string;
    }>;
    hasMatches: boolean;
    incompleteFields: string[];
    preparedAtIso: string;
  }>;
};

const ASSESSED_AT = new Date("2026-08-20T12:00:00.000Z");

describe("assembleGrantMatchSummaryInput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes only ELIGIBLE grants and reflects a LIVE AI outputSource", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      address: "456 Fallback Rd",
      draftData: {
        addressLine1: "123 Main St",
        city: "Toronto",
        province: "ON",
        postalCode: "M5V 2T6",
      },
      photos: [{ declaredModificationCodes: ["GRAB_BARS"] }],
      user: { name: "Sam Applicant" },
      eligibilityAssessments: [
        {
          id: "assess-1",
          createdAt: ASSESSED_AT,
          discoveryProvider: "OPENAI",
          discoveredGrants: [
            {
              grantId: "hatc_canada",
              title: "Home Accessibility Tax Credit",
              decision: "ELIGIBLE",
              confidence: "HIGH",
              estimatedFundingAmount: "Up to $20,000",
              summary: "Federal tax credit for eligible accessibility renovations.",
            },
            {
              grantId: "on_needs_info",
              title: "Ontario Program Needing More Info",
              decision: "NEEDS_MORE_INFO",
              confidence: "MEDIUM",
              estimatedFundingAmount: null,
              summary: "Requires income verification.",
            },
            {
              grantId: "on_ineligible",
              title: "Ineligible Program",
              decision: "INELIGIBLE",
              confidence: "LOW",
              estimatedFundingAmount: null,
              summary: "Does not match.",
            },
          ],
        },
      ],
    });

    const result = await assembleGrantMatchSummaryInput("proj-1");

    expect(result).toMatchObject({
      projectId: "proj-1",
      eligibilityAssessmentId: "assess-1",
      clientName: "Sam Applicant",
      projectAddress: "123 Main St, Toronto, ON, M5V 2T6",
      modificationType: "Grab Bars",
      assessmentDate: ASSESSED_AT.toISOString(),
      outputSource: "LIVE",
      hasMatches: true,
      incompleteFields: [],
    });
    expect(result.matchedGrants).toEqual([
      {
        programName: "Home Accessibility Tax Credit",
        eligibilityStatus: "ELIGIBLE",
        confidence: "HIGH",
        estimatedFunding: "Up to $20,000",
        scopeDescription: "Federal tax credit for eligible accessibility renovations.",
      },
    ]);
  });

  it("returns hasMatches: false with an empty matchedGrants list when nothing is ELIGIBLE", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-2",
      address: "789 Side St",
      draftData: {},
      photos: [],
      user: { name: "Tenant User" },
      manualModeSubmission: { modificationType: "Custom ramp install" },
      eligibilityAssessments: [
        {
          id: "assess-2",
          createdAt: ASSESSED_AT,
          discoveryProvider: "HEURISTIC",
          discoveredGrants: [
            {
              grantId: "on_ineligible",
              title: "Ineligible Program",
              decision: "INELIGIBLE",
              confidence: "LOW",
              estimatedFundingAmount: null,
              summary: "Does not match.",
            },
          ],
        },
      ],
    });

    const result = await assembleGrantMatchSummaryInput("proj-2");

    expect(result.hasMatches).toBe(false);
    expect(result.matchedGrants).toEqual([]);
    expect(result.outputSource).toBe("HEURISTIC");
    expect(result.modificationType).toBe("Custom ramp install");
  });

  it("marks missing fields as [Incomplete] and records them, never throwing", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-3",
      address: null,
      draftData: {},
      photos: [],
      user: { name: null },
      eligibilityAssessments: [
        {
          id: "assess-3",
          createdAt: ASSESSED_AT,
          discoveryProvider: null,
          discoveredGrants: [],
        },
      ],
    });

    const result = await assembleGrantMatchSummaryInput("proj-3");

    expect(result.clientName).toBe("[Incomplete]");
    expect(result.projectAddress).toBe("[Incomplete]");
    expect(result.modificationType).toBe("[Incomplete]");
    expect(result.outputSource).toBe("NONE");
    expect(result.hasMatches).toBe(false);
    expect(result.incompleteFields).toEqual(
      expect.arrayContaining(["client name", "project address", "modification type"])
    );
  });

  it("throws when the project does not exist", async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    await expect(assembleGrantMatchSummaryInput("missing")).rejects.toThrow("Project not found");
  });

  it("throws when the project has no eligibility assessment", async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: "proj-4",
      address: "1 Nowhere Ave",
      draftData: {},
      photos: [],
      user: { name: "No Assessment User" },
      eligibilityAssessments: [],
    });

    await expect(assembleGrantMatchSummaryInput("proj-4")).rejects.toThrow(
      "No eligibility assessment found for project"
    );
  });
});
