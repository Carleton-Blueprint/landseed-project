import { createHash } from "crypto";
import { prisma } from "lib/prisma";
import { uploadToS3 } from "lib/s3";
import { generateGrantPdf } from "@/backend/services/pdf";
import { assembleGrantPdfInput, AssembledGrantPdfInput } from "./grantPdfAssembler";
import { fillGrantTemplate } from "./grantTemplateFill";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export interface GenerateAndStoreGrantDocumentInput {
  projectId: string;
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Bypass the "skip if nothing relevant changed" check (e.g. an admin-triggered manual regenerate). */
  force?: boolean;
}

export interface GenerateAndStoreGrantDocumentResult {
  projectId: string;
  grantDocumentKey: string;
  previousGrantDocumentKey: string | null;
  /** False when generation was skipped because no relevant field changed since the last version. */
  regenerated: boolean;
}

const GRANT_DOCUMENT_GENERATE_ACTION = "PROJECT_GRANT_DOCUMENT_GENERATE";

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

// Fingerprints the fields that actually appear on the document. preparedAtIso
// is deliberately excluded so re-running eligibility/quote generation with no
// real change doesn't churn out a new S3 version every time.
function computeContentHash(assembled: AssembledGrantPdfInput): string {
  const relevantFields = {
    applicantName: assembled.applicantName,
    applicantEmail: assembled.applicantEmail,
    applicantPhone: assembled.applicantPhone,
    projectAddress: assembled.projectAddress,
    projectId: assembled.projectId,
    grantProgramName: assembled.grantProgramName,
    modificationItems: assembled.modificationItems,
    estimatedCost: assembled.estimatedCost,
    ownershipStatus: assembled.ownershipStatus,
    incompleteFields: assembled.incompleteFields,
  };
  return createHash("sha256").update(JSON.stringify(relevantFields)).digest("hex");
}

export interface LatestGrantDocumentGenerationInfo {
  generatedAt: Date;
  incompleteFields: string[];
}

// Powers the dashboard's "last generated" / "incomplete fields" display.
// Looks past skip-events (which only confirm the existing file is still
// current) to the most recent event where a file was actually written.
export async function getLatestGrantDocumentGenerationInfo(
  projectId: string
): Promise<LatestGrantDocumentGenerationInfo | null> {
  const events = await prisma.auditEvent.findMany({
    where: {
      projectId,
      action: GRANT_DOCUMENT_GENERATE_ACTION,
      outcome: "SUCCESS",
      resourceType: "project_document",
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { createdAt: true, metadata: true },
  });

  for (const event of events) {
    if (event.metadata && typeof event.metadata === "object" && "generator" in event.metadata) {
      const metadata = event.metadata as { incompleteFields?: unknown };
      const incompleteFields = Array.isArray(metadata.incompleteFields)
        ? metadata.incompleteFields.filter((f): f is string => typeof f === "string")
        : [];
      return { generatedAt: event.createdAt, incompleteFields };
    }
  }

  return null;
}

async function getLastSuccessfulGenerationMetadata(
  projectId: string
): Promise<{ contentHash?: string } | null> {
  const lastEvent = await prisma.auditEvent.findFirst({
    where: {
      projectId,
      action: GRANT_DOCUMENT_GENERATE_ACTION,
      outcome: "SUCCESS",
      resourceType: "project_document",
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });

  if (!lastEvent?.metadata || typeof lastEvent.metadata !== "object") {
    return null;
  }

  return lastEvent.metadata as { contentHash?: string };
}

async function generatePdfBuffer(assembled: AssembledGrantPdfInput): Promise<{ buffer: Buffer; generator: string }> {
  try {
    const buffer = await fillGrantTemplate(assembled);
    return { buffer, generator: "template" };
  } catch (error) {
    console.warn("Grant template fill failed, falling back to generic PDF generator:", error);
    const buffer = await generateGrantPdf({
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
    return { buffer, generator: "generic-fallback" };
  }
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
    action: GRANT_DOCUMENT_GENERATE_ACTION,
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId,
    projectId: project.id,
    resourceType: "project_document",
    resourceId: project.id,
    description: "Grant document generation started",
    metadata: {
      previousGrantDocumentKey: project.grantDocumentKey,
      force: input.force ?? false,
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  try {
    const assembled = await assembleGrantPdfInput(project.id);
    const contentHash = computeContentHash(assembled);

    if (!input.force && project.grantDocumentKey) {
      const lastMetadata = await getLastSuccessfulGenerationMetadata(project.id);
      if (lastMetadata?.contentHash === contentHash) {
        await logAuditEventNonBlocking({
          category: "MANUAL_CHANGE",
          action: GRANT_DOCUMENT_GENERATE_ACTION,
          outcome: "SUCCESS",
          sensitivityLevel: "RESTRICTED",
          actorUserId: input.actorUserId,
          projectId: project.id,
          resourceType: "project_document",
          resourceId: project.id,
          description: "Grant document generation skipped: no relevant fields changed since last version",
          metadata: {
            grantDocumentKey: project.grantDocumentKey,
            contentHash,
            skipped: true,
          },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        });

        return {
          projectId: project.id,
          grantDocumentKey: project.grantDocumentKey,
          previousGrantDocumentKey: project.grantDocumentKey,
          regenerated: false,
        };
      }
    }

    const version = getNextGrantDocumentVersion(project.grantDocumentKey);
    const grantDocumentKey = `projects/${project.id}/grant/grant-application-v${version}.pdf`;

    const { buffer: pdfBuffer, generator } = await generatePdfBuffer(assembled);

    await uploadToS3(pdfBuffer, grantDocumentKey, "application/pdf");

    await prisma.project.update({
      where: { id: project.id },
      data: {
        grantDocumentKey,
      },
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: GRANT_DOCUMENT_GENERATE_ACTION,
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
        generator,
        contentHash,
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
      regenerated: true,
    };
  } catch (error) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: GRANT_DOCUMENT_GENERATE_ACTION,
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
