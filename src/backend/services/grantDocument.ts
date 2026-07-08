import { prisma } from "lib/prisma";
import { uploadToS3 } from "lib/s3";
import { generateGrantPdf } from "@/backend/services/pdf";
import { assembleGrantPdfInput } from "./grantPdfAssembler";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export interface GenerateAndStoreGrantDocumentInput {
  projectId: string;
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface GenerateAndStoreGrantDocumentResult {
  projectId: string;
  grantDocumentKey: string;
  previousGrantDocumentKey: string | null;
}

function getNextGrantDocumentVersion(existingKey: string | null): number {
  if (!existingKey) {
    return 1;
  }

  const match = existingKey.match(/-v(\d+)\.pdf$/i);
  if (!match) {
    return 1;
  }

  const parsed = Number.parseInt(match[1], 10);
  if (Number.isNaN(parsed)) {
    return 1;
  }

  return parsed + 1;
}

export async function generateAndStoreGrantDocument(
  input: GenerateAndStoreGrantDocumentInput
): Promise<GenerateAndStoreGrantDocumentResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      address: true,
      grantDocumentKey: true,
      user: {
        select: {
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "PROJECT_GRANT_DOCUMENT_GENERATE",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId,
    projectId: project.id,
    resourceType: "project_document",
    resourceId: project.id,
    description: "Grant document generation started",
    metadata: {
      previousGrantDocumentKey: project.grantDocumentKey,
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  try {
    const assembled = await assembleGrantPdfInput(project.id);

    const version = getNextGrantDocumentVersion(project.grantDocumentKey);
    const grantDocumentKey = `projects/${project.id}/grant/grant-application-v${version}.pdf`;

    const pdfBuffer = await generateGrantPdf({
      projectAddress: assembled.projectAddress,
      applicantName: assembled.applicantName,
      applicantEmail: assembled.applicantEmail,
      applicantPhone: assembled.applicantPhone ?? undefined,
      projectId: assembled.projectId,
      grantProgramName: assembled.grantProgramName,
      modificationItems: assembled.modificationItems,
      estimatedFundingAmount: assembled.estimatedCost ?? '',
      ownershipStatus: assembled.ownershipStatus,
      incompleteFields: assembled.incompleteFields,
      preparedAtIso: assembled.preparedAtIso,
    });

    await uploadToS3(pdfBuffer, grantDocumentKey, "application/pdf");

    await prisma.project.update({
      where: { id: project.id },
      data: {
        grantDocumentKey,
      },
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_GRANT_DOCUMENT_GENERATE",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: input.actorUserId,
      projectId: project.id,
      resourceType: "project_document",
      resourceId: project.id,
      description: "Grant document generated, uploaded, and linked to project",
      metadata: {
        previousGrantDocumentKey: project.grantDocumentKey,
        grantDocumentKey,
        version,
        // include incomplete fields if available
        incompleteFields: assembled.incompleteFields,
      },
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    return {
      projectId: project.id,
      grantDocumentKey,
      previousGrantDocumentKey: project.grantDocumentKey,
    };
  } catch (error) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_GRANT_DOCUMENT_GENERATE",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      actorUserId: input.actorUserId,
      projectId: project.id,
      resourceType: "project_document",
      resourceId: project.id,
      description: "Grant document generation failed",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        previousGrantDocumentKey: project.grantDocumentKey,
      },
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
    throw error;
  }
}