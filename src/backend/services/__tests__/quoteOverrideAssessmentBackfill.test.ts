/**
 * @jest-environment node
 */
/**
 * Real Postgres (DATABASE_URL) required. Runs the
 * add_quote_override_eligibility_assessment migration's backfill against
 * fixtures inside a transaction that is rolled back, so it never touches the
 * shared dev database. If the migration hasn't been deployed to this database
 * yet, its schema statements are applied inside the same transaction first
 * (Postgres DDL is transactional, so they roll back too).
 */

import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "lib/prisma";

jest.setTimeout(30000);

const MIGRATION_SQL = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20261102120000_add_quote_override_eligibility_assessment/migration.sql"),
  "utf8"
);
const BACKFILL_MARKER = "-- Backfill:";
const SCHEMA_SQL = MIGRATION_SQL.slice(0, MIGRATION_SQL.indexOf(BACKFILL_MARKER));
const BACKFILL_SQL = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf(BACKFILL_MARKER));

function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

class Rollback extends Error {}

const assessmentFields = {
  overallDecision: "ELIGIBLE" as const,
  programDecisions: {},
  reasonCodes: [],
  missingRequirements: [],
};

const overrideFields = {
  reason: "backfill test",
  subtotal: 900,
  total: 900,
  previousTotal: 1000,
  lineItems: [],
  modificationCodes: [],
  eligibilityDecision: "ELIGIBLE" as const,
  grantOverrides: {},
};

describe("add_quote_override_eligibility_assessment backfill (real DB)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sets each override's assessment to the project's latest assessment at or before its updatedAt", async () => {
    const results: Record<string, string | null> = {};
    const ids: Record<string, string> = {};

    await prisma
      .$transaction(
        async (tx) => {
          const [{ exists }] = await tx.$queryRaw<Array<{ exists: boolean }>>`
            SELECT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'QuoteOverride' AND column_name = 'eligibilityAssessmentId'
            ) AS exists
          `;
          if (!exists) {
            for (const statement of statements(SCHEMA_SQL)) await tx.$executeRawUnsafe(statement);
          }

          const user = await tx.user.create({
            data: { id: `test-qo-backfill-${randomUUID()}`, email: `${randomUUID()}@example.com`, name: "Backfill Admin" },
          });
          const project = await tx.project.create({ data: { address: "1 Backfill Blvd", userId: user.id, draftData: {} } });
          const otherProject = await tx.project.create({ data: { address: "2 Backfill Blvd", userId: user.id, draftData: {} } });
          const at = (iso: string) => new Date(iso);

          await tx.eligibilityAssessment.create({
            data: { ...assessmentFields, projectId: project.id, isLatest: false, createdAt: at("2026-10-01T00:00:00Z") },
          });
          const atOverrideTime = await tx.eligibilityAssessment.create({
            data: { ...assessmentFields, projectId: project.id, isLatest: false, createdAt: at("2026-10-02T00:00:00Z") },
          });
          // Admin AI re-run after the override: must not be picked.
          await tx.eligibilityAssessment.create({
            data: { ...assessmentFields, projectId: project.id, isLatest: true, createdAt: at("2026-10-05T00:00:00Z") },
          });
          // Another project's newer assessment: must not leak across projects.
          await tx.eligibilityAssessment.create({
            data: { ...assessmentFields, projectId: otherProject.id, createdAt: at("2026-10-02T12:00:00Z") },
          });
          ids.atOverrideTime = atOverrideTime.id;

          const quote = await tx.quote.create({ data: { projectId: project.id, subtotal: 1000, total: 1000 } });
          const override = await tx.quoteOverride.create({
            data: { ...overrideFields, quoteId: quote.id, overriddenByUserId: user.id, updatedAt: at("2026-10-03T00:00:00Z") },
          });

          // Overridden before its project had any assessment of its own at that time.
          const earlyQuote = await tx.quote.create({ data: { projectId: otherProject.id, subtotal: 1000, total: 1000 } });
          const earlyOverride = await tx.quoteOverride.create({
            data: { ...overrideFields, quoteId: earlyQuote.id, overriddenByUserId: user.id, updatedAt: at("2026-10-01T00:00:00Z") },
          });

          for (const statement of statements(BACKFILL_SQL)) await tx.$executeRawUnsafe(statement);

          const read = async (id: string) =>
            (
              await tx.$queryRaw<Array<{ eligibilityAssessmentId: string | null }>>`
                SELECT "eligibilityAssessmentId" FROM "QuoteOverride" WHERE "id" = ${id}
              `
            )[0].eligibilityAssessmentId;
          results.override = await read(override.id);
          results.earlyOverride = await read(earlyOverride.id);

          throw new Rollback();
        },
        { timeout: 20000 }
      )
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });

    expect(results.override).toBe(ids.atOverrideTime);
    expect(results.earlyOverride).toBeNull();
  });
});
