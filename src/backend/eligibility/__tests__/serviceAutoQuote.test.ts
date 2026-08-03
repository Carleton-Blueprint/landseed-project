/**
 * @jest-environment node
 */
/**
 * Covers Step 6 of evaluateProjectEligibility (src/backend/eligibility/service.ts):
 * the background "ensure the project has a quote" trigger. Verifies it now routes
 * through the same buildQuoteItems/normalizeModificationItems -> generateQuote
 * pipeline as the delayed intake worker, instead of a hardcoded $5000 placeholder.
 *
 * Everything except @/backend/services/estimateGeneration and
 * @/backend/eligibility/modificationNormalization is mocked, so buildQuoteItems/
 * getIntakeModificationLabels run for real against a crafted draftData fixture.
 */
import type { Project } from "@prisma/client";
import { EligibilityDecision } from "@/backend/eligibility/types";

jest.mock("lib/prisma", () => ({
  prisma: { quote: { findFirst: jest.fn() } },
}));

jest.mock("@/backend/services/quote", () => ({
  generateQuote: jest.fn(async () => ({
    quoteId: "quote-new",
    subtotal: 0,
    total: 0,
    estimateMin: 0,
    estimateMax: 0,
    pricingSource: "serp_api",
    refinedEstimate: { lineItems: [], modificationTotals: [], subtotal: 0, laborTotal: 0, markupTotal: 0, total: 0, estimateMin: 0, estimateMax: 0 },
  })),
}));

// estimateGeneration.ts statically imports these two — mocked so loading it for
// real (via service.ts's dynamic import) doesn't also spin up BullMQ/Redis queues.
jest.mock("@/backend/services/estimateReadyTransition", () => ({
  markEstimateReadyForReview: jest.fn(),
}));
jest.mock("@/backend/eligibility/triggers", () => ({
  queueEligibilityEvaluation: jest.fn(),
  triggerEvaluationAfterDraftUpdate: jest.fn(),
  triggerEvaluationAfterProjectCreation: jest.fn(),
}));

jest.mock("@/backend/eligibility/assembler", () => ({
  assembleEligibilityInput: jest.fn(() => ({})),
}));

jest.mock("@/backend/eligibility/discoverySearchProvider", () => ({
  discoverAndEvaluateGrants: jest.fn(async () => ({
    overallDecision: EligibilityDecision.NEEDS_MORE_INFO,
    programDecisions: {},
    reasonCodes: [],
    staffReasonMessages: [],
    clientReasonMessages: [],
    missingRequirements: [],
    discoveredGrants: [],
    discoveryMetadata: {
      provider: "HEURISTIC",
      engineVersion: "test",
      promptVersion: "test",
      scoringVersion: "test",
      modelVersion: "test",
      sourceSnapshotId: null,
      query: "test",
      searchedScopes: [],
      candidateCount: 0,
      returnedCount: 0,
      executedAt: new Date().toISOString(),
    },
  })),
}));

jest.mock("@/backend/eligibility/repository", () => ({
  createEligibilityAssessmentSnapshot: jest.fn(async () => ({
    id: "assessment-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  })),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(async () => undefined),
}));

jest.mock("@/backend/eligibility/manualReviewProducer", () => ({
  produceManualReviewFlagJob: jest.fn(async () => undefined),
}));

import { prisma } from "lib/prisma";
import { generateQuote } from "@/backend/services/quote";
import { evaluateProjectEligibility } from "@/backend/eligibility/service";

const mockedFindFirst = (prisma as unknown as { quote: { findFirst: jest.Mock } }).quote.findFirst;
const mockedGenerateQuote = generateQuote as jest.MockedFunction<typeof generateQuote>;

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    userId: "user-1",
    address: "123 Test St",
    status: "submitted",
    draftData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Project;
}

async function flushSetImmediate(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe("evaluateProjectEligibility Step 6 (auto-quote)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("generates a catalog-priced, modification-tagged quote when none exists and draftData has real modifications", async () => {
    mockedFindFirst.mockResolvedValue(null);

    await evaluateProjectEligibility(
      buildProject({
        id: "proj-1",
        draftData: { modificationItems: ["Grab bars", "Walk-in shower"] },
      })
    );
    await flushSetImmediate();

    expect(mockedGenerateQuote).toHaveBeenCalledWith({
      projectId: "proj-1",
      items: [
        { description: "Grab bars", quantity: 1, unitPrice: 180, modificationCode: "GRAB_BARS" },
        { description: "Walk-in shower", quantity: 1, unitPrice: 4800, modificationCode: "WALK_IN_SHOWER" },
      ],
      modificationCodes: ["GRAB_BARS", "WALK_IN_SHOWER"],
    });
  });

  it("falls back to the $150 placeholder item (not $5000) when draftData is empty", async () => {
    mockedFindFirst.mockResolvedValue(null);

    await evaluateProjectEligibility(buildProject({ id: "proj-2", draftData: null }));
    await flushSetImmediate();

    expect(mockedGenerateQuote).toHaveBeenCalledWith({
      projectId: "proj-2",
      items: [{ description: "Home modifications (initial intake estimate)", quantity: 1, unitPrice: 150 }],
      modificationCodes: [],
    });
  });

  it("does not generate a quote when one already exists for the project", async () => {
    mockedFindFirst.mockResolvedValue({ id: "quote-existing" });

    await evaluateProjectEligibility(
      buildProject({ id: "proj-3", draftData: { modificationItems: ["Grab bars"] } })
    );
    await flushSetImmediate();

    expect(mockedGenerateQuote).not.toHaveBeenCalled();
  });
});
