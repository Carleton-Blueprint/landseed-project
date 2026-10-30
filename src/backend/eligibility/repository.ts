import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "lib/prisma";

export type EligibilityAssessmentSourceValue = "AUTOMATIC" | "ADMIN";
export type EligibilityAdminActionValue = "PRE_ESTIMATE_OVERRIDE" | "REASSESS" | "MANUAL_GRANTS";

interface EligibilityAssessmentSnapshotFields {
  projectId: string;
  overallDecision: "ELIGIBLE" | "INELIGIBLE" | "NEEDS_MORE_INFO" | "MANUAL_REVIEW";
  programDecisions: Prisma.InputJsonValue;
  reasonCodes: Prisma.InputJsonValue;
  missingRequirements: Prisma.InputJsonValue;
  discoveredGrants?: Prisma.InputJsonValue;
  discoveryMetadata?: Prisma.InputJsonValue;
  discoveryProvider?: string;
  discoveryEngineVersion?: string;
  discoveryPromptVersion?: string;
  discoveryScoringVersion?: string;
  discoveryModelVersion?: string;
  discoverySourceSnapshotId?: string | null;
  discoverySourcesSnapshot?: Prisma.InputJsonValue;
  discoveryOpenAiResponseEntries?: Prisma.InputJsonValue | null;
}

export interface AdminEligibilityAssessmentSnapshotInput extends EligibilityAssessmentSnapshotFields {
  source: "ADMIN";
  adminAction: EligibilityAdminActionValue;
  /** The admin/staff user who triggered it. Null only when there's no session (CLI script). */
  createdByUserId: string | null;
}

export interface AutomaticEligibilityAssessmentSnapshotInput extends EligibilityAssessmentSnapshotFields {
  source: "AUTOMATIC";
  /** When this run started (before grant discovery), for the in-lock race guard. */
  automaticRunStartedAt: Date;
}

export type CreateEligibilityAssessmentSnapshotInput =
  | AdminEligibilityAssessmentSnapshotInput
  | AutomaticEligibilityAssessmentSnapshotInput;

export type EligibilitySnapshotSkipReason = "ADMIN_ASSESSMENT_SINCE_RUN_STARTED" | "QUOTE_OVERRIDE_EXISTS";

/** Returned instead of a row when an AUTOMATIC write lost to an admin result. */
export interface SkippedEligibilityAssessmentSnapshot {
  skipped: true;
  reason: EligibilitySnapshotSkipReason;
}

export function isSkippedEligibilitySnapshot(
  result: EligibilityAssessmentRow | SkippedEligibilityAssessmentSnapshot | null
): result is SkippedEligibilityAssessmentSnapshot {
  return result !== null && "skipped" in result;
}

export interface EligibilityAssessmentRow {
  id: string;
  projectId: string;
  overallDecision: "ELIGIBLE" | "INELIGIBLE" | "NEEDS_MORE_INFO" | "MANUAL_REVIEW";
  programDecisions: Prisma.JsonValue;
  reasonCodes: Prisma.JsonValue;
  missingRequirements: Prisma.JsonValue;
  discoveredGrants: Prisma.JsonValue | null;
  discoveryMetadata: Prisma.JsonValue | null;
  discoveryProvider: string | null;
  discoveryEngineVersion: string | null;
  discoveryPromptVersion: string | null;
  discoveryScoringVersion: string | null;
  discoveryModelVersion: string | null;
  discoverySourceSnapshotId: string | null;
  discoverySourcesSnapshot: Prisma.JsonValue | null;
  discoveryOpenAiResponseEntries: Prisma.JsonValue | null;
  source: EligibilityAssessmentSourceValue;
  adminAction: EligibilityAdminActionValue | null;
  createdByUserId: string | null;
  isLatest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Creates an immutable eligibility snapshot and marks it as latest for the project.
 *
 * AUTOMATIC writes are skipped (nothing inserted, SkippedEligibilityAssessmentSnapshot
 * returned) when an admin result should win: see the in-lock check below. ADMIN
 * writes are never skipped.
 */
export async function createEligibilityAssessmentSnapshot(
  input: AdminEligibilityAssessmentSnapshotInput
): Promise<EligibilityAssessmentRow | null>;
export async function createEligibilityAssessmentSnapshot(
  input: CreateEligibilityAssessmentSnapshotInput
): Promise<EligibilityAssessmentRow | SkippedEligibilityAssessmentSnapshot | null>;
export async function createEligibilityAssessmentSnapshot(
  input: CreateEligibilityAssessmentSnapshotInput
): Promise<EligibilityAssessmentRow | SkippedEligibilityAssessmentSnapshot | null> {
  const programDecisionsJson = JSON.stringify(input.programDecisions);
  const reasonCodesJson = JSON.stringify(input.reasonCodes);
  const missingRequirementsJson = JSON.stringify(input.missingRequirements);
  const assessmentId = randomUUID();

  return prisma.$transaction(async (tx) => {
    // Serializes concurrent snapshot creation for the same project (e.g. the
    // automatic post-estimate-generation trigger racing an admin's manual
    // re-assess). Without this, two concurrent transactions can each read
    // "no isLatest row yet" under READ COMMITTED and both insert one, leaving
    // two rows marked isLatest = true. Transaction-scoped, so it releases
    // automatically on commit/rollback.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}))`;

    // Race guard for AUTOMATIC writes, re-checked under the lock (triggers.ts
    // checks up front, but grant discovery runs between that check and here).
    // Skip if an admin result landed after this run started, or the latest
    // quote has a post-estimate QuoteOverride. Note: createdAt is DB time and
    // automaticRunStartedAt is app time, so clock skew of a second or two can
    // shift the boundary slightly.
    if (input.source === "AUTOMATIC") {
      const [guard] = await tx.$queryRaw<Array<{ adminSinceRunStarted: boolean; quoteOverrideExists: boolean }>>(
        Prisma.sql`
          SELECT
            EXISTS (
              SELECT 1 FROM "EligibilityAssessment"
              WHERE "projectId" = ${input.projectId}
                AND "source" = 'ADMIN'
                AND "createdAt" > ${input.automaticRunStartedAt}
            ) AS "adminSinceRunStarted",
            EXISTS (
              SELECT 1 FROM "QuoteOverride"
              WHERE "quoteId" = (
                SELECT "id" FROM "Quote"
                WHERE "projectId" = ${input.projectId}
                ORDER BY "createdAt" DESC
                LIMIT 1
              )
            ) AS "quoteOverrideExists"
        `
      );

      if (guard?.adminSinceRunStarted) {
        return { skipped: true, reason: "ADMIN_ASSESSMENT_SINCE_RUN_STARTED" } as const;
      }
      if (guard?.quoteOverrideExists) {
        return { skipped: true, reason: "QUOTE_OVERRIDE_EXISTS" } as const;
      }
    }

    const adminAction = input.source === "ADMIN" ? input.adminAction : null;
    const createdByUserId = input.source === "ADMIN" ? input.createdByUserId : null;

    await tx.$executeRaw(
      Prisma.sql`
        UPDATE "EligibilityAssessment"
        SET "isLatest" = false,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "projectId" = ${input.projectId}
          AND "isLatest" = true
      `
    );

    const rows = await tx.$queryRaw<EligibilityAssessmentRow[]>(
      Prisma.sql`
        INSERT INTO "EligibilityAssessment" (
          "id",
          "projectId",
          "overallDecision",
          "programDecisions",
          "reasonCodes",
          "missingRequirements",
          "discoveredGrants",
          "discoveryMetadata",
          "discoveryProvider",
          "discoveryEngineVersion",
          "discoveryPromptVersion",
          "discoveryScoringVersion",
          "discoveryModelVersion",
          "discoverySourceSnapshotId",
          "discoverySourcesSnapshot",
          "discoveryOpenAiResponseEntries",
          "source",
          "adminAction",
          "createdByUserId",
          "isLatest",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${assessmentId},
          ${input.projectId},
          ${input.overallDecision}::"EligibilityDecision",
          CAST(${programDecisionsJson} AS JSONB),
          CAST(${reasonCodesJson} AS JSONB),
          CAST(${missingRequirementsJson} AS JSONB),
          CAST(${JSON.stringify(input.discoveredGrants ?? null)} AS JSONB),
          CAST(${JSON.stringify(input.discoveryMetadata ?? null)} AS JSONB),
          ${input.discoveryProvider ?? null},
          ${input.discoveryEngineVersion ?? null},
          ${input.discoveryPromptVersion ?? null},
          ${input.discoveryScoringVersion ?? null},
          ${input.discoveryModelVersion ?? null},
          ${input.discoverySourceSnapshotId ?? null},
          CAST(${JSON.stringify(input.discoverySourcesSnapshot ?? null)} AS JSONB),
          CAST(${JSON.stringify(input.discoveryOpenAiResponseEntries ?? null)} AS JSONB),
          ${input.source}::"EligibilityAssessmentSource",
          ${adminAction}::"EligibilityAdminAction",
          ${createdByUserId},
          true,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING *
      `
    );

    return rows[0] ?? null;
  });
}
