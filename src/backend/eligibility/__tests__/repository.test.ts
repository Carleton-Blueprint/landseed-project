/**
 * @jest-environment node
 *
 * Uses the node test environment because repository.ts uses `Prisma.sql`
 * from @prisma/client, whose browser bundle (loaded under jsdom) throws.
 * See grantPdfTrigger.test.ts for the same precedent with setImmediate.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: { $transaction: jest.Mock };
};

const { createEligibilityAssessmentSnapshot } = require("../repository") as {
  createEligibilityAssessmentSnapshot: (
    input: Record<string, unknown>
  ) => Promise<unknown>;
};

function baseInput() {
  return {
    projectId: "project-1",
    overallDecision: "ELIGIBLE",
    programDecisions: { CMHC: "ELIGIBLE" },
    reasonCodes: ["SOME_CODE"],
    missingRequirements: [],
  };
}

describe("createEligibilityAssessmentSnapshot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("runs the advisory lock then $executeRaw then $queryRaw within the transaction, and returns rows[0]", async () => {
    const callOrder: string[] = [];
    const insertedRow = { id: "assessment-1", projectId: "project-1", isLatest: true };

    const tx = {
      $executeRaw: jest.fn(async () => {
        callOrder.push("$executeRaw");
        return 1;
      }),
      $queryRaw: jest.fn(async () => {
        callOrder.push("$queryRaw");
        return [insertedRow];
      }),
    };

    prisma.$transaction.mockImplementation(async (callback) =>
      (callback as (tx: unknown) => Promise<unknown>)(tx)
    );

    const result = await createEligibilityAssessmentSnapshot(baseInput());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Once for the pg_advisory_xact_lock race guard, once for the UPDATE.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["$executeRaw", "$executeRaw", "$queryRaw"]);
    expect(result).toEqual(insertedRow);
  });

  it("bakes projectId into the $executeRaw UPDATE statement values", async () => {
    const tx = {
      $executeRaw: jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1),
      $queryRaw: jest.fn<(...args: unknown[]) => Promise<Array<{ id: string }>>>().mockResolvedValue([{ id: "assessment-2" }]),
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      (callback as (tx: unknown) => Promise<unknown>)(tx)
    );

    await createEligibilityAssessmentSnapshot(baseInput());

    // Call 0 is the pg_advisory_xact_lock tagged-template race guard; call 1
    // is the UPDATE ... isLatest = false statement.
    const sqlArg = tx.$executeRaw.mock.calls[1][0] as { sql: string; values: unknown[] };
    expect(sqlArg.sql).toContain('UPDATE "EligibilityAssessment"');
    expect(sqlArg.sql).toContain('"isLatest" = false');
    expect(sqlArg.values).toContain("project-1");
  });

  it("bakes the assessment fields into the $queryRaw INSERT statement values", async () => {
    const tx = {
      $executeRaw: jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1),
      $queryRaw: jest.fn<(...args: unknown[]) => Promise<Array<{ id: string }>>>().mockResolvedValue([{ id: "assessment-3" }]),
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      (callback as (tx: unknown) => Promise<unknown>)(tx)
    );

    const input = {
      projectId: "project-3",
      overallDecision: "MANUAL_REVIEW",
      programDecisions: { CMHC: "MANUAL_REVIEW" },
      reasonCodes: ["RULESET_REQUIRES_MANUAL_REVIEW"],
      missingRequirements: ["PROVINCE"],
      discoveredGrants: [{ name: "Grant A" }],
      discoveryMetadata: { candidateCount: 3 },
      discoveryProvider: "provider-x",
      discoveryEngineVersion: "v1",
      discoveryPromptVersion: "p1",
      discoveryScoringVersion: "s1",
      discoveryModelVersion: "m1",
      discoverySourceSnapshotId: "snapshot-1",
    };

    await createEligibilityAssessmentSnapshot(input);

    const sqlArg = tx.$queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sqlArg.sql).toContain('INSERT INTO "EligibilityAssessment"');
    expect(sqlArg.sql).toContain("RETURNING *");
    expect(sqlArg.values).toContain("project-3");
    expect(sqlArg.values).toContain("MANUAL_REVIEW");
    expect(sqlArg.values).toContain(JSON.stringify(input.programDecisions));
    expect(sqlArg.values).toContain(JSON.stringify(input.reasonCodes));
    expect(sqlArg.values).toContain(JSON.stringify(input.missingRequirements));
    expect(sqlArg.values).toContain(JSON.stringify(input.discoveredGrants));
    expect(sqlArg.values).toContain(JSON.stringify(input.discoveryMetadata));
    expect(sqlArg.values).toContain("provider-x");
    expect(sqlArg.values).toContain("v1");
    expect(sqlArg.values).toContain("p1");
    expect(sqlArg.values).toContain("s1");
    expect(sqlArg.values).toContain("m1");
    expect(sqlArg.values).toContain("snapshot-1");
  });

  it("defaults optional discovery fields to null in the INSERT values when omitted", async () => {
    const tx = {
      $executeRaw: jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1),
      $queryRaw: jest.fn<(...args: unknown[]) => Promise<Array<{ id: string }>>>().mockResolvedValue([{ id: "assessment-4" }]),
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      (callback as (tx: unknown) => Promise<unknown>)(tx)
    );

    await createEligibilityAssessmentSnapshot(baseInput());

    const sqlArg = tx.$queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sqlArg.values).toContain(JSON.stringify(null));
    expect(sqlArg.values.filter((v) => v === null).length).toBeGreaterThan(0);
  });

  it("returns null when $queryRaw resolves to an empty array", async () => {
    const tx = {
      $executeRaw: jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1),
      $queryRaw: jest.fn<(...args: unknown[]) => Promise<Array<{ id: string }>>>().mockResolvedValue([]),
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      (callback as (tx: unknown) => Promise<unknown>)(tx)
    );

    const result = await createEligibilityAssessmentSnapshot(baseInput());

    expect(result).toBeNull();
  });
});
