/**
 * @jest-environment node
 */
/**
 * Real Postgres (DATABASE_URL) required; no mocked Prisma client. Walks the two
 * scenarios behind QuoteOverride.eligibilityAssessmentId end to end, through
 * the real override service and every reader, and checks they agree:
 *
 * 1. Normal intake flow: the quote is generated before eligibility runs (so
 *    Quote.eligibilityAssessmentId is null), then an admin makes a
 *    post-estimate override. Every reader applies its pricing and grant edits.
 * 2. An admin then re-runs eligibility. Every reader keeps the overridden
 *    price but drops the grant edits and the client's staff-override line.
 *
 * Only side effects outside Postgres are mocked (session, notifications,
 * queue, audit log).
 */

import { randomUUID } from "crypto";
import { prisma } from "lib/prisma";
import { createEligibilityAssessmentSnapshot } from "@/backend/eligibility/repository";
import { overridePostEstimateQuote, resolveEffectiveQuoteView } from "@/backend/services/quoteOverride";
import { assembleGrantPdfInput } from "@/backend/services/grantPdfAssembler";
import { assembleGrantMatchSummaryInput } from "@/backend/services/grantMatchSummaryAssembler";
import { aggregateDeclaredModificationCodes } from "@/backend/eligibility/modificationNormalization";

jest.setTimeout(60000);

const mockSessionUserId = { current: "" };
jest.mock("@/auth", () => ({
  auth: jest.fn(async () => ({ user: { id: mockSessionUserId.current } })),
}));
// The client viewing their own project: owner, but no staff access.
jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn(async () => false),
}));
jest.mock("@/backend/services/estimateUpdatedNotification", () => ({
  notifyEstimateUpdated: jest.fn(async () => ({ notified: false })),
}));
jest.mock("@/backend/queue", () => ({
  grantMatchSummaryQueue: { add: jest.fn(async () => undefined) },
}));
jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(async () => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require("@/app/api/eligibility/[projectId]/route") as {
  GET: (request: Request, context: { params: Promise<{ projectId: string }> }) => Promise<Response>;
};

function aiGrant(grantId: string, title: string) {
  return {
    grantId,
    title,
    scope: "PROVINCIAL",
    jurisdiction: "Ontario",
    sourceUrl: null,
    summary: `${title} summary`,
    decision: "ELIGIBLE",
    relevanceScore: 80,
    confidence: "HIGH",
    matchedCriteria: [],
    missingCriteria: [],
    rationale: "",
    estimatedFundingAmount: null,
  };
}

const AI_GRANTS = [aiGrant("grant-ontario", "Ontario Home Grant"), aiGrant("grant-federal", "Federal Credit")];

function snapshotFields(projectId: string) {
  return {
    projectId,
    overallDecision: "NEEDS_MORE_INFO" as const,
    programDecisions: {},
    reasonCodes: [],
    missingRequirements: [],
    discoveredGrants: AI_GRANTS,
  };
}

/** What each surface shows for the project right now. */
async function readEverySurface(projectId: string) {
  const apiBody = (await (
    await GET(new Request(`https://example.com/api/eligibility/${projectId}`), {
      params: Promise.resolve({ projectId }),
    })
  ).json()) as { staffOverridden: boolean; overallDecision: string; discovery: { discoveredGrants: Array<{ title: string }> } };

  const pdf = await assembleGrantPdfInput(projectId);
  const summary = await assembleGrantMatchSummaryInput(projectId);

  // Same inputs the admin dashboard (src/app/admin/page.tsx) passes.
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { photos: { select: { declaredModificationCodes: true } } },
  });
  const latestQuote = await prisma.quote.findFirstOrThrow({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { override: true },
  });
  const latestAssessment = await prisma.eligibilityAssessment.findFirst({ where: { projectId, isLatest: true } });
  const admin = resolveEffectiveQuoteView(
    latestQuote,
    latestQuote.override,
    latestAssessment,
    aggregateDeclaredModificationCodes(project.photos)
  );

  return {
    api: {
      staffOverridden: apiBody.staffOverridden,
      decision: apiBody.overallDecision,
      grantTitles: apiBody.discovery.discoveredGrants.map((g) => g.title),
    },
    pdf: { estimatedCost: pdf.estimatedCost, grantProgramName: pdf.grantProgramName },
    summary: { staffOverridden: summary.staffOverridden, grantTitles: summary.matchedGrants.map((g) => g.programName) },
    admin: {
      total: admin.total,
      isOverridden: admin.isOverridden,
      eligibilityOverridden: admin.eligibilityOverridden,
      decision: admin.eligibilityDecision,
      grantTitles: admin.discoveredGrants.map((g) => g.title),
    },
  };
}

describe("post-estimate override scenarios (real DB)", () => {
  let clientId: string;
  let adminId: string;
  let projectId: string;
  let photoId: string;

  beforeEach(async () => {
    const client = await prisma.user.create({
      data: { id: `test-override-client-${randomUUID()}`, email: `${randomUUID()}@example.com`, name: "Scenario Client" },
    });
    const admin = await prisma.user.create({
      data: { id: `test-override-admin-${randomUUID()}`, email: `${randomUUID()}@example.com`, name: "Scenario Admin" },
    });
    clientId = client.id;
    adminId = admin.id;
    mockSessionUserId.current = clientId;

    const project = await prisma.project.create({
      data: {
        address: "1 Scenario St",
        userId: clientId,
        draftData: { name: "Scenario Client", addressLine1: "1 Scenario St", city: "Toronto", province: "ON" },
      },
    });
    projectId = project.id;
    const photo = await prisma.photo.create({
      data: { projectId, url: "https://example.com/scenario.jpg", declaredModificationCodes: ["GRAB_BARS"] },
    });
    photoId = photo.id;

    // Normal intake order: the quote exists before eligibility runs, so it
    // carries no eligibilityAssessmentId.
    await prisma.quote.create({
      data: { projectId, subtotal: 1000, total: 1000, estimateMin: 900, estimateMax: 1100 },
    });
    await createEligibilityAssessmentSnapshot({
      ...snapshotFields(projectId),
      source: "AUTOMATIC",
      automaticRunStartedAt: new Date(),
    });
  });

  afterEach(async () => {
    await prisma.quote.deleteMany({ where: { projectId } });
    await prisma.eligibilityAssessment.deleteMany({ where: { projectId } });
    await prisma.photo.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [clientId, adminId] } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function adminOverrides() {
    await overridePostEstimateQuote({
      projectId,
      actorUserId: adminId,
      photoModifications: [{ photoId, declaredModificationCodes: ["GRAB_BARS"] }],
      pricing: {
        lineItems: [{ description: "Grab bars, installed", quantity: 2, materialTotal: 500, laborTotal: 750 }],
        subtotal: 1250,
        total: 1500,
      },
      eligibilityDecision: "ELIGIBLE",
      grantChanges: {
        removedGrantIds: ["grant-ontario"],
        addedGrants: [{ title: "Staff Confirmed Grant", scope: "MUNICIPAL", jurisdiction: "Toronto", decision: "ELIGIBLE" }],
      },
      reason: "Confirmed scope and funding with the client by phone",
    });
  }

  it("normal flow: an override made on an unlinked quote applies everywhere", async () => {
    await adminOverrides();

    const latestAssessment = await prisma.eligibilityAssessment.findFirstOrThrow({ where: { projectId, isLatest: true } });
    const quote = await prisma.quote.findFirstOrThrow({ where: { projectId }, include: { override: true } });
    expect(quote.eligibilityAssessmentId).toBeNull();
    expect(quote.override?.eligibilityAssessmentId).toBe(latestAssessment.id);

    const surfaces = await readEverySurface(projectId);
    const overriddenGrants = ["Federal Credit", "Staff Confirmed Grant"];

    expect(surfaces.api).toEqual({ staffOverridden: true, decision: "ELIGIBLE", grantTitles: overriddenGrants });
    expect(surfaces.summary).toEqual({ staffOverridden: true, grantTitles: overriddenGrants });
    expect(surfaces.pdf).toEqual({ estimatedCost: "$1,500", grantProgramName: "Federal Credit" });
    expect(surfaces.admin).toEqual({
      total: 1500,
      isOverridden: true,
      eligibilityOverridden: true,
      decision: "ELIGIBLE",
      grantTitles: overriddenGrants,
    });
  });

  it("admin re-run after the override: every surface keeps the price but drops the grant edits", async () => {
    await adminOverrides();

    // Same grant ids as before, so only the assessment id tells the readers
    // the override's edits are stale.
    await createEligibilityAssessmentSnapshot({
      ...snapshotFields(projectId),
      source: "ADMIN",
      adminAction: "REASSESS",
      createdByUserId: adminId,
    });

    const surfaces = await readEverySurface(projectId);
    const aiGrantTitles = ["Ontario Home Grant", "Federal Credit"];

    expect(surfaces.api).toEqual({ staffOverridden: false, decision: "NEEDS_MORE_INFO", grantTitles: aiGrantTitles });
    expect(surfaces.summary).toEqual({ staffOverridden: false, grantTitles: aiGrantTitles });
    // Decision is no longer the override's ELIGIBLE, so no single program is named.
    expect(surfaces.pdf).toEqual({ estimatedCost: "$1,500", grantProgramName: "Landseed Grant Application" });
    expect(surfaces.admin).toEqual({
      total: 1500,
      isOverridden: true,
      eligibilityOverridden: false,
      decision: "NEEDS_MORE_INFO",
      grantTitles: aiGrantTitles,
    });
  });

  it("re-overriding after the admin re-run applies the new edits everywhere again", async () => {
    await adminOverrides();
    await createEligibilityAssessmentSnapshot({
      ...snapshotFields(projectId),
      source: "ADMIN",
      adminAction: "REASSESS",
      createdByUserId: adminId,
    });

    await adminOverrides();

    const surfaces = await readEverySurface(projectId);
    expect(surfaces.api.staffOverridden).toBe(true);
    expect(surfaces.summary.staffOverridden).toBe(true);
    expect(surfaces.admin.eligibilityOverridden).toBe(true);
    expect(surfaces.api.grantTitles).toEqual(["Federal Credit", "Staff Confirmed Grant"]);
    expect(surfaces.summary.grantTitles).toEqual(surfaces.api.grantTitles);
    expect(surfaces.admin.grantTitles).toEqual(surfaces.api.grantTitles);
  });
});
