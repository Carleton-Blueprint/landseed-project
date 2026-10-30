/**
 * @jest-environment node
 */
/**
 * Real Postgres (DATABASE_URL) required; no mocked Prisma client. Exercises
 * createEligibilityAssessmentSnapshot's in-lock race guard: an AUTOMATIC write
 * must not land on top of an ADMIN result that committed while it was in
 * flight, or on a project whose latest quote has a post-estimate QuoteOverride.
 */

import { prisma } from "lib/prisma";
import { randomUUID } from "crypto";
import {
  createEligibilityAssessmentSnapshot,
  type AdminEligibilityAssessmentSnapshotInput,
  type AutomaticEligibilityAssessmentSnapshotInput,
} from "@/backend/eligibility/repository";

jest.setTimeout(30000);

const baseFields = {
  overallDecision: "ELIGIBLE" as const,
  programDecisions: {},
  reasonCodes: [],
  missingRequirements: [],
};

function automaticInput(projectId: string, automaticRunStartedAt: Date): AutomaticEligibilityAssessmentSnapshotInput {
  return { ...baseFields, projectId, source: "AUTOMATIC", automaticRunStartedAt };
}

function adminInput(projectId: string, userId: string): AdminEligibilityAssessmentSnapshotInput {
  return { ...baseFields, projectId, source: "ADMIN", adminAction: "REASSESS", createdByUserId: userId };
}

async function waitForAdvisoryLockWaiter() {
  for (let i = 0; i < 100; i++) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*) AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
    `;
    if (Number(row.waiting) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("AUTOMATIC write never started waiting on the advisory lock");
}

describe("createEligibilityAssessmentSnapshot race guard (real DB)", () => {
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { id: `test-elig-race-${randomUUID()}`, email: `${randomUUID()}@example.com`, name: "Race Test Admin" },
    });
    userId = user.id;
    const project = await prisma.project.create({
      data: { address: "1 Race Condition Rd", userId, draftData: {} },
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await prisma.quote.deleteMany({ where: { projectId } });
    await prisma.eligibilityAssessment.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("discards an AUTOMATIC write blocked on the lock while an ADMIN result commits", async () => {
    const automaticRunStartedAt = new Date(Date.now() - 1000);

    let releaseAdmin!: () => void;
    const adminMayCommit = new Promise<void>((resolve) => (releaseAdmin = resolve));
    let adminLocked!: () => void;
    const adminHasLock = new Promise<void>((resolve) => (adminLocked = resolve));

    // Stands in for an admin snapshot transaction: takes the same per-project
    // lock, inserts an ADMIN row, and holds the lock until told to commit.
    const adminTx = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
        await tx.eligibilityAssessment.create({
          data: { ...baseFields, projectId, source: "ADMIN", adminAction: "REASSESS", createdByUserId: userId },
        });
        adminLocked();
        await adminMayCommit;
      },
      { timeout: 20000 }
    );

    await adminHasLock;
    const automaticWrite = createEligibilityAssessmentSnapshot(automaticInput(projectId, automaticRunStartedAt));
    await waitForAdvisoryLockWaiter();
    releaseAdmin();
    await adminTx;

    const result = await automaticWrite;

    expect(result).toEqual({ skipped: true, reason: "ADMIN_ASSESSMENT_SINCE_RUN_STARTED" });
    const rows = await prisma.eligibilityAssessment.findMany({ where: { projectId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "ADMIN", isLatest: true, createdByUserId: userId });
  });

  it("leaves exactly one isLatest row, the ADMIN one, when both writes race", async () => {
    const automaticRunStartedAt = new Date(Date.now() - 1000);

    const [adminResult, automaticResult] = await Promise.all([
      createEligibilityAssessmentSnapshot(adminInput(projectId, userId)),
      createEligibilityAssessmentSnapshot(automaticInput(projectId, automaticRunStartedAt)),
    ]);

    expect(adminResult).toMatchObject({ source: "ADMIN" });
    const latest = await prisma.eligibilityAssessment.findMany({ where: { projectId, isLatest: true } });
    expect(latest).toHaveLength(1);
    expect(latest[0].source).toBe("ADMIN");
    // Whichever took the lock first, the automatic write either never landed
    // or landed first and was then superseded.
    if ("skipped" in (automaticResult ?? {})) {
      expect(automaticResult).toEqual({ skipped: true, reason: "ADMIN_ASSESSMENT_SINCE_RUN_STARTED" });
    }
  });

  it("inserts an AUTOMATIC write when the only ADMIN row predates the run", async () => {
    await createEligibilityAssessmentSnapshot(adminInput(projectId, userId));
    const automaticRunStartedAt = new Date(Date.now() + 1000);

    const result = await createEligibilityAssessmentSnapshot(automaticInput(projectId, automaticRunStartedAt));

    expect(result).toMatchObject({ source: "AUTOMATIC", adminAction: null, createdByUserId: null, isLatest: true });
    const latest = await prisma.eligibilityAssessment.findMany({ where: { projectId, isLatest: true } });
    expect(latest).toHaveLength(1);
    expect(latest[0].source).toBe("AUTOMATIC");
  });

  it("discards an AUTOMATIC write when the latest quote has a QuoteOverride", async () => {
    const quote = await prisma.quote.create({ data: { projectId, subtotal: 1000, total: 1000 } });
    await prisma.quoteOverride.create({
      data: {
        quoteId: quote.id,
        overriddenByUserId: userId,
        reason: "race test",
        subtotal: 900,
        total: 900,
        previousTotal: 1000,
        lineItems: [],
        modificationCodes: [],
        eligibilityDecision: "ELIGIBLE",
        grantOverrides: {},
      },
    });

    const result = await createEligibilityAssessmentSnapshot(automaticInput(projectId, new Date()));

    expect(result).toEqual({ skipped: true, reason: "QUOTE_OVERRIDE_EXISTS" });
    expect(await prisma.eligibilityAssessment.count({ where: { projectId } })).toBe(0);
  });

  it("inserts an AUTOMATIC write when the latest quote has no QuoteOverride", async () => {
    await prisma.quote.create({ data: { projectId, subtotal: 1000, total: 1000 } });

    const result = await createEligibilityAssessmentSnapshot(automaticInput(projectId, new Date()));

    expect(result).toMatchObject({ source: "AUTOMATIC", isLatest: true });
  });
});
