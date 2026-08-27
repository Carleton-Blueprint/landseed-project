import { beforeEach, describe, expect, it, jest } from "@jest/globals";
/* eslint-disable @typescript-eslint/no-require-imports */

process.env.GRANT_DISCOVERY_DEV_MOCK_GET = "false";

jest.mock("@/auth", () => ({
  auth: jest.fn<() => Promise<unknown>>(),
}));

jest.mock("@/backend/eligibility/service", () => ({
  getLatestEligibilityAssessment: jest.fn(),
}));

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
}));

const mockedProjectFindUnique = jest.fn<() => Promise<unknown>>();
const mockedQuoteFindFirst = jest.fn<() => Promise<unknown>>();
jest.mock("lib/prisma", () => ({
  prisma: {
    project: { findUnique: mockedProjectFindUnique },
    quote: { findFirst: mockedQuoteFindFirst },
  },
}));

(globalThis as { Response?: { json: (body: unknown, init?: { status?: number }) => Response } }).Response = {
  json: (body: unknown, init?: { status?: number }) =>
    ({
      status: init?.status ?? 200,
      json: async () => body,
    }) as Response,
};

const { GET } = require("../route") as {
  GET: (request: Request, context: { params: Promise<{ projectId: string }> }) => Promise<Response>;
};

const { auth } = require("@/auth") as { auth: jest.Mock };
const { getLatestEligibilityAssessment } = require("@/backend/eligibility/service") as {
  getLatestEligibilityAssessment: jest.Mock;
};
const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedAssessment = getLatestEligibilityAssessment as jest.MockedFunction<() => Promise<unknown>>;

const projectId = "project-1";

function buildRequest(): Request {
  return { url: `https://example.com/api/eligibility/${projectId}` } as unknown as Request;
}

function buildParams() {
  return { params: Promise.resolve({ projectId }) };
}

const baseAssessment = {
  assessmentId: "assessment-1",
  projectId,
  overallDecision: "MANUAL_REVIEW",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  discoveryProvider: "OPENAI",
  discoveryMetadata: {},
  discoveredGrants: [
    {
      grantId: "grant-ai-1",
      title: "AI Found Grant",
      scope: "PROVINCIAL",
      jurisdiction: "Ontario",
      sourceUrl: "https://example.com",
      summary: "summary",
      decision: "ELIGIBLE",
      relevanceScore: 90,
      confidence: "HIGH",
      matchedCriteria: ["a"],
      missingCriteria: [],
      rationale: "matches criteria",
      estimatedFundingAmount: null,
    },
  ],
  discoveryEngineVersion: "1",
  discoveryPromptVersion: "1",
  discoveryScoringVersion: "1",
  discoveryModelVersion: "gpt",
  discoverySourceSnapshotId: null,
};

describe("GET /api/eligibility/[projectId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockedProjectFindUnique.mockResolvedValue({ id: projectId, userId: "user-1", user: {} });
    mockedAssessment.mockResolvedValue(baseAssessment);
  });

  it("returns the raw AI assessment untouched when there is no override", async () => {
    mockedQuoteFindFirst.mockResolvedValue({ id: "quote-1", override: null });

    const response = await GET(buildRequest(), buildParams());
    const body = await response.json();

    expect(body.overallDecision).toBe("MANUAL_REVIEW");
    expect(body.discovery.discoveredGrants).toEqual(baseAssessment.discoveredGrants);
  });

  it("merges an existing override's decision and grant changes into the response", async () => {
    mockedQuoteFindFirst.mockResolvedValue({
      id: "quote-1",
      override: {
        eligibilityDecision: "ELIGIBLE",
        grantOverrides: {
          removedGrantIds: [],
          decisionOverrides: [{ grantId: "grant-ai-1", decision: "INELIGIBLE" }],
          addedGrants: [
            { id: "manual-1", title: "Manual Grant", scope: "MUNICIPAL", jurisdiction: "Toronto", decision: "ELIGIBLE", note: "Confirmed by phone" },
          ],
        },
      },
    });

    const response = await GET(buildRequest(), buildParams());
    const body = await response.json();

    expect(body.overallDecision).toBe("ELIGIBLE");
    const grants = body.discovery.discoveredGrants;
    expect(grants).toHaveLength(2);
    const aiGrant = grants.find((g: { grantId: string }) => g.grantId === "grant-ai-1");
    expect(aiGrant).toMatchObject({ decision: "INELIGIBLE", rationale: "matches criteria" });
    const manualGrant = grants.find((g: { grantId: string }) => g.grantId === "manual-1");
    expect(manualGrant).toMatchObject({ title: "Manual Grant", decision: "ELIGIBLE", rationale: "Confirmed by phone" });
  });
});
