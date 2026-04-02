import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "lib/prisma";

export interface CreateEligibilityAssessmentSnapshotInput {
  projectId: string;
  grantRulesVersionId: string;
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
}

interface EligibilityAssessmentRow {
  id: string;
  projectId: string;
  grantRulesVersionId: string;
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
  isLatest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Creates an immutable eligibility snapshot and marks it as latest for the project.
 */
export async function createEligibilityAssessmentSnapshot(
  input: CreateEligibilityAssessmentSnapshotInput
) {
  const programDecisionsJson = JSON.stringify(input.programDecisions);
  const reasonCodesJson = JSON.stringify(input.reasonCodes);
  const missingRequirementsJson = JSON.stringify(input.missingRequirements);
  const assessmentId = randomUUID();

  return prisma.$transaction(async (tx) => {
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
          "grantRulesVersionId",
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
          "isLatest",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${assessmentId},
          ${input.projectId},
          ${input.grantRulesVersionId},
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
