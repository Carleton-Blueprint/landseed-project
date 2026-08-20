/**
 * @jest-environment node
 */
/**
 * FR-3.1 Integration Tests — real Postgres (DATABASE_URL) and real Redis
 * (REDIS_URL) required; no mocked Prisma client. Exercises the full
 * assemble -> evaluate -> persist -> audit chain through evaluateProjectEligibility(),
 * including the live-AI-failure -> heuristic-fallback path and the
 * GRANT_DISCOVERY_MOCK_AI hardcoded-mock path, verifying each is recorded
 * with distinct, correct provenance in the audit trail (see the AI Mock
 * Finalization work in src/backend/audit/aiProvenance.ts).
 *
 * The original version of this file was entirely placeholder stubs
 * (`expect(true).toBe(true)`), including sections describing a fixed
 * pricing-matrix/grant-rules versioning system ("rule version activation
 * re-evaluation", batch re-evaluation of 100 projects) that was later
 * deliberately removed in favor of the current AI-driven, live-data
 * approach (see prisma/migrations/20260709190000_remove_pricing_matrix_version
 * and the reconciled TO-DO.md FR-2.7 entry) — those sections are dropped
 * here rather than rewritten, since there's no current implementation for
 * them to test. Rate-limiting of repeated evaluations was also never
 * implemented in evaluateProjectEligibility, so that placeholder is dropped
 * too rather than asserting behavior that doesn't exist.
 *
 * API-endpoint-level coverage (assess/retrieve/history, access control)
 * already exists in src/app/api/admin/eligibility/assess/__tests__/route.test.ts
 * and is not duplicated here.
 */

import { prisma } from "lib/prisma";
import { randomUUID } from "crypto";
import {
  evaluateProjectEligibility,
  getLatestEligibilityAssessment,
  ProjectWithPhotosForEligibility,
} from "@/backend/eligibility/service";
import type { TieredRefinedEstimate } from "@/backend/services/pricingTiers";

jest.setTimeout(30000);

// evaluateProjectEligibility() fires an unawaited background auto-quote
// placeholder via setImmediate (see the "Step 6" comment in service.ts). Left
// unmocked, it routinely outlives a test's own assertions/cleanup — hitting
// the real SerpAPI pricing lookup (up to an 8s timeout) and then failing with
// a foreign-key violation once it tries to write a Quote for a project the
// test has already deleted. manualReviewIntegration.test.ts hit the same
// issue and mocks it for the same reason. Tests below that specifically want
// a real, persisted Quote import the unmocked module via requireActual and
// call generateQuote() directly instead of relying on this background path.
jest.mock("@/backend/services/quote", () => {
  const actual = jest.requireActual("@/backend/services/quote");
  return {
    ...actual,
    generateQuote: jest.fn(async () => ({
      quoteId: "background-auto-quote-stub",
      subtotal: 5000,
      total: 5000,
      estimateMin: 5000,
      estimateMax: 5000,
      pricingSource: "serp_api" as const,
      refinedEstimate: { lineItems: [], modificationTotals: [], subtotal: 5000, laborTotal: 0, markupTotal: 0, total: 5000, estimateMin: 5000, estimateMax: 5000 },
    })),
  };
});

const { generateQuote, getPricingDecisionAuditTrail } = jest.requireActual(
  "@/backend/services/quote"
) as typeof import("@/backend/services/quote");

// The same background block also auto-generates a grant PDF (real S3 upload) once
// the mocked quote resolves, if the assessment came back ELIGIBLE — which the
// GRANT_DISCOVERY_MOCK_AI catalog's first entry always does. Mock it out for the
// same reason as generateQuote above: it isn't the subject of these tests, and it
// otherwise fires a real upload against a project the test has already deleted.
jest.mock("@/backend/services/grantDocument", () => ({
  generateAndStoreGrantDocument: jest.fn(async () => ({ s3Key: "test-grant-doc-stub" })),
}));

async function createTestUser() {
  return prisma.user.create({
    data: { id: `test-eligibility-${randomUUID()}`, email: `${randomUUID()}@example.com`, name: "Test User" },
  });
}

async function createTestProject(
  userId: string,
  draftData: Record<string, unknown> = {}
): Promise<ProjectWithPhotosForEligibility> {
  const project = await prisma.project.create({
    data: {
      address: "123 Integration Test St",
      userId,
      draftData: {
        province: "ON",
        ownershipStatus: "owner",
        clientConsentConfirmed: true,
        ...draftData,
      },
    },
  });

  await prisma.photo.create({
    data: {
      projectId: project.id,
      url: "https://example.com/test-photo.jpg",
      declaredModificationCodes: ["GRAB_BARS"],
    },
  });

  return { ...project, photos: [{ declaredModificationCodes: ["GRAB_BARS"] }] };
}

async function cleanupProject(projectId: string) {
  await prisma.auditEvent.deleteMany({ where: { projectId } });
  await prisma.quote.deleteMany({ where: { projectId } });
  await prisma.eligibilityAssessment.deleteMany({ where: { projectId } });
  await prisma.projectManualReviewFlag.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
}

describe("FR-3.1 Eligibility Integration Tests", () => {
  const createdUserIds: string[] = [];
  const originalEnv = { ...process.env };

  afterAll(async () => {
    process.env = originalEnv;
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  describe("Full eligibility evaluation flow", () => {
    it("assembles input, evaluates, persists an assessment, and logs an audit event", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const project = await createTestProject(user.id);

      try {
        const result = await evaluateProjectEligibility(project);

        if (!("assessmentId" in result)) {
          throw new Error(`Expected a successful evaluation, got: ${JSON.stringify(result)}`);
        }

        expect(result.overallDecision).toBeDefined();
        expect(result.projectId).toBe(project.id);

        const persisted = await prisma.eligibilityAssessment.findUnique({
          where: { id: result.assessmentId },
        });
        expect(persisted).not.toBeNull();
        expect(persisted?.isLatest).toBe(true);
        expect(persisted?.discoveryProvider).toBeTruthy();

        // ELIGIBILITY_EVALUATED is only logged when performedBy is passed — call again as staff.
        await evaluateProjectEligibility(project, user);
        const auditEvent = await prisma.auditEvent.findFirst({
          where: { action: "ELIGIBILITY_EVALUATED", projectId: project.id },
          orderBy: { createdAt: "desc" },
        });
        expect(auditEvent).not.toBeNull();
        expect((auditEvent?.metadata as Record<string, unknown>)?.outputSource).toBeDefined();
        expect((auditEvent?.metadata as Record<string, unknown>)?.isFallback).toBeDefined();
      } finally {
        await cleanupProject(project.id);
      }
    });

    it("returns NEEDS_MORE_INFO-shaped results and records missing fields when draftData is empty", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const project = await prisma.project.create({
        data: { address: "1 Malformed Draft Ave", userId: user.id, draftData: {} },
      });

      try {
        const result = await evaluateProjectEligibility({ ...project, photos: [] });

        if (!("assessmentId" in result)) {
          throw new Error(`Expected a successful evaluation, got: ${JSON.stringify(result)}`);
        }

        expect(result.missingRequirements.length).toBeGreaterThan(0);
        expect(result.reasonCodes).toContain("MISSING_REQUIRED_FIELDS");
      } finally {
        await cleanupProject(project.id);
      }
    });
  });

  describe("Live AI failure -> heuristic fallback", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("falls back to the heuristic catalog and logs GRANT_DISCOVERY_AI_FALLBACK when the live call fails", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      process.env.GRANT_DISCOVERY_AI_ENABLED = "true";
      process.env.GRANT_DISCOVERY_MOCK_AI = "false";

      global.fetch = jest.fn(async () =>
        new Response("upstream error", { status: 500, statusText: "Internal Server Error" })
      ) as unknown as typeof fetch;

      const user = await createTestUser();
      createdUserIds.push(user.id);
      const project = await createTestProject(user.id);

      try {
        const result = await evaluateProjectEligibility(project);

        if (!("assessmentId" in result)) {
          throw new Error(`Expected a successful evaluation, got: ${JSON.stringify(result)}`);
        }

        const persisted = await prisma.eligibilityAssessment.findUnique({
          where: { id: result.assessmentId },
        });
        expect(persisted?.discoveryProvider).toBe("HEURISTIC");

        const fallbackEvent = await prisma.auditEvent.findFirst({
          where: { action: "GRANT_DISCOVERY_AI_FALLBACK", projectId: project.id },
        });
        expect(fallbackEvent).not.toBeNull();
        expect(fallbackEvent?.outcome).toBe("FAILURE");
        const metadata = fallbackEvent?.metadata as Record<string, unknown>;
        expect(metadata?.outputSource).toBe("HEURISTIC");
        expect(metadata?.isFallback).toBe(true);
      } finally {
        await cleanupProject(project.id);
      }
    });

    it("labels GRANT_DISCOVERY_MOCK_AI output as MOCK (not OPENAI or a failure fallback)", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      process.env.GRANT_DISCOVERY_AI_ENABLED = "true";
      process.env.GRANT_DISCOVERY_MOCK_AI = "true";

      const user = await createTestUser();
      createdUserIds.push(user.id);
      const project = await createTestProject(user.id);

      try {
        const result = await evaluateProjectEligibility(project);

        if (!("assessmentId" in result)) {
          throw new Error(`Expected a successful evaluation, got: ${JSON.stringify(result)}`);
        }

        const persisted = await prisma.eligibilityAssessment.findUnique({
          where: { id: result.assessmentId },
        });
        expect(persisted?.discoveryProvider).toBe("MOCK");

        const fallbackEvent = await prisma.auditEvent.findFirst({
          where: { action: "GRANT_DISCOVERY_AI_FALLBACK", projectId: project.id },
        });
        expect(fallbackEvent).toBeNull();
      } finally {
        await cleanupProject(project.id);
      }
    });
  });

  describe("Quote integration", () => {
    it("links a generated quote to its eligibility assessment and records provenance in the audit trail", async () => {
      process.env.GRANT_DISCOVERY_MOCK_AI = "true";

      const user = await createTestUser();
      createdUserIds.push(user.id);
      const project = await createTestProject(user.id);

      try {
        const evaluation = await evaluateProjectEligibility(project);
        if (!("assessmentId" in evaluation)) {
          throw new Error(`Expected a successful evaluation, got: ${JSON.stringify(evaluation)}`);
        }

        const quote = await generateQuote({
          projectId: project.id,
          items: [{ description: "Grab bars", quantity: 1, unitPrice: 150, modificationCode: "GRAB_BARS" }],
        });

        expect(quote.eligibilityAssessmentId).toBe(evaluation.assessmentId);

        const auditTrail = await getPricingDecisionAuditTrail({ quoteId: quote.quoteId });
        expect(auditTrail.length).toBeGreaterThan(0);
        expect(auditTrail[0].metadata?.eligibilityAssessmentId).toBe(evaluation.assessmentId);
        expect(auditTrail[0].metadata?.outputSource).toBeDefined();
      } finally {
        await cleanupProject(project.id);
      }
    });

    it("spans estimateMin/estimateMax across all tiers, not just the standard tier, for a tiered quote", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const project = await createTestProject(user.id);

      try {
        const quote = await generateQuote({
          projectId: project.id,
          items: [
            { description: "Walk-in shower", quantity: 1, unitPrice: 4000, modificationCode: "WALK_IN_SHOWER" },
          ],
          modificationCodes: ["WALK_IN_SHOWER"],
        });

        const tiered = quote.refinedEstimate as TieredRefinedEstimate;
        expect(tiered.tiers).toBeDefined();

        const persisted = await prisma.quote.findUnique({ where: { id: quote.quoteId } });
        expect(Number(persisted?.estimateMin)).toBe(tiered.tiers.economy.estimateMin);
        expect(Number(persisted?.estimateMax)).toBe(tiered.tiers.premium.estimateMax);
        // Sanity check this is actually a wider span than the standard tier
        // alone would give - otherwise the assertions above wouldn't catch a
        // regression back to the single-tier behavior.
        expect(Number(persisted?.estimateMin)).toBeLessThan(tiered.tiers.standard.estimateMin);
        expect(Number(persisted?.estimateMax)).toBeGreaterThan(tiered.tiers.standard.estimateMax);
      } finally {
        await cleanupProject(project.id);
      }
    });

    it("creates a quote even without a prior eligibility assessment", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const project = await createTestProject(user.id);

      try {
        const quote = await generateQuote({
          projectId: project.id,
          items: [{ description: "Grab bars", quantity: 1, unitPrice: 150 }],
        });

        expect(quote.quoteId).toBeDefined();
        expect(quote.eligibilityAssessmentId).toBeUndefined();
      } finally {
        await cleanupProject(project.id);
      }
    });
  });

  describe("Audit trail completeness", () => {
    it("getLatestEligibilityAssessment reflects the same provenance recorded on the audit event", async () => {
      process.env.GRANT_DISCOVERY_MOCK_AI = "true";

      const user = await createTestUser();
      createdUserIds.push(user.id);
      const project = await createTestProject(user.id);

      try {
        await evaluateProjectEligibility(project, user);

        const latest = await getLatestEligibilityAssessment(project.id);
        expect(latest?.discoveryProvider).toBe("MOCK");

        const auditEvent = await prisma.auditEvent.findFirst({
          where: { action: "ELIGIBILITY_EVALUATED", projectId: project.id },
        });
        expect((auditEvent?.metadata as Record<string, unknown>)?.discoveryProvider).toBe("MOCK");
      } finally {
        await cleanupProject(project.id);
      }
    });
  });
});
