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
}

interface EligibilityAssessmentRow {
  id: string;
  projectId: string;
  grantRulesVersionId: string;
  overallDecision: "ELIGIBLE" | "INELIGIBLE" | "NEEDS_MORE_INFO" | "MANUAL_REVIEW";
  programDecisions: Prisma.JsonValue;
  reasonCodes: Prisma.JsonValue;
  missingRequirements: Prisma.JsonValue;
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

export async function getLatestEligibilityAssessmentForProject(projectId: string) {
  const rows = await prisma.$queryRaw<EligibilityAssessmentRow[]>(
    Prisma.sql`
      SELECT *
      FROM "EligibilityAssessment"
      WHERE "projectId" = ${projectId}
        AND "isLatest" = true
      ORDER BY "createdAt" DESC
      LIMIT 1
    `
  );

  return rows[0] ?? null;
}
