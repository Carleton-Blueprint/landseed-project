import { createHash } from 'crypto';
import { prisma } from 'lib/prisma';
import { uploadToS3 } from 'lib/s3';
import { logAuditEventNonBlocking } from '@/backend/audit/log';
import { assembleGrantMatchSummaryInput, AssembledGrantMatchSummaryInput } from './grantMatchSummaryAssembler';
import { generateGrantMatchSummaryPdf } from './grantMatchSummaryPdf';

export interface GenerateAndStoreGrantMatchSummaryInput {
  projectId: string;
  actorUserId: string;
  /** Bypass the "skip if nothing relevant changed" check (e.g. an admin-triggered manual regenerate). */
  force?: boolean;
}

export interface GenerateAndStoreGrantMatchSummaryResult {
  documentId: string;
  projectId: string;
  s3Key: string;
  fileName: string;
  /** False when generation was skipped because no relevant field changed since the last version. */
  regenerated: boolean;
}

const GRANT_MATCH_SUMMARY_GENERATE_ACTION = 'PROJECT_GRANT_MATCH_SUMMARY_GENERATE';

// Fingerprints the fields that actually appear on the document. preparedAtIso
// is deliberately excluded so re-running eligibility with no real change
// doesn't churn out a new S3 version every time (mirrors grantDocument.ts).
function computeContentHash(assembled: AssembledGrantMatchSummaryInput): string {
  const relevantFields = {
    clientName: assembled.clientName,
    projectAddress: assembled.projectAddress,
    modificationType: assembled.modificationType,
    assessmentDate: assembled.assessmentDate,
    outputSource: assembled.outputSource,
    matchedGrants: assembled.matchedGrants,
    hasMatches: assembled.hasMatches,
    incompleteFields: assembled.incompleteFields,
  };
  return createHash('sha256').update(JSON.stringify(relevantFields)).digest('hex');
}

export async function generateAndStoreGrantMatchSummaryDocument(
  input: GenerateAndStoreGrantMatchSummaryInput
): Promise<GenerateAndStoreGrantMatchSummaryResult> {
  const latest = await prisma.grantMatchSummaryDocument.findFirst({
    where: { projectId: input.projectId, isLatest: true },
  });

  const assembled = await assembleGrantMatchSummaryInput(input.projectId);
  const contentHash = computeContentHash(assembled);

  if (!input.force && latest?.status === 'READY' && latest.contentHash === contentHash && latest.s3Key && latest.fileName) {
    await logAuditEventNonBlocking({
      category: 'MANUAL_CHANGE',
      action: GRANT_MATCH_SUMMARY_GENERATE_ACTION,
      outcome: 'SUCCESS',
      sensitivityLevel: 'RESTRICTED',
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      resourceType: 'grant_match_summary_document',
      resourceId: latest.id,
      description: 'Grant match summary generation skipped: no relevant fields changed since last version',
      metadata: { documentId: latest.id, s3Key: latest.s3Key, contentHash, skipped: true },
    });

    return {
      documentId: latest.id,
      projectId: input.projectId,
      s3Key: latest.s3Key,
      fileName: latest.fileName,
      regenerated: false,
    };
  }

  const version = (latest?.version ?? 0) + 1;
  const fileName = `grant-match-summary-v${version}.pdf`;
  const s3Key = `projects/${input.projectId}/grant-match-summary/${fileName}`;

  if (latest) {
    await prisma.grantMatchSummaryDocument.update({
      where: { id: latest.id },
      data: { isLatest: false },
    });
  }

  const created = await prisma.grantMatchSummaryDocument.create({
    data: {
      projectId: input.projectId,
      eligibilityAssessmentId: assembled.eligibilityAssessmentId,
      status: 'PENDING',
      outputSource: assembled.outputSource,
      contentHash,
      version,
      isLatest: true,
      requestedAt: new Date(),
    },
  });

  try {
    const pdfBuffer = await generateGrantMatchSummaryPdf(assembled);
    await uploadToS3(pdfBuffer, s3Key, 'application/pdf');

    await prisma.grantMatchSummaryDocument.update({
      where: { id: created.id },
      data: { status: 'READY', s3Key, fileName, readyAt: new Date() },
    });

    await logAuditEventNonBlocking({
      category: 'MANUAL_CHANGE',
      action: GRANT_MATCH_SUMMARY_GENERATE_ACTION,
      outcome: 'SUCCESS',
      sensitivityLevel: 'RESTRICTED',
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      resourceType: 'grant_match_summary_document',
      resourceId: created.id,
      description: 'Grant match summary generated, uploaded, and stored',
      metadata: {
        documentId: created.id,
        s3Key,
        version,
        contentHash,
        hasMatches: assembled.hasMatches,
        matchedGrantCount: assembled.matchedGrants.length,
        outputSource: assembled.outputSource,
        incompleteFields: assembled.incompleteFields,
      },
    });

    return { documentId: created.id, projectId: input.projectId, s3Key, fileName, regenerated: true };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : 'Unknown error';

    await prisma.grantMatchSummaryDocument.update({
      where: { id: created.id },
      data: { status: 'FAILED', failureReason },
    });

    await logAuditEventNonBlocking({
      category: 'MANUAL_CHANGE',
      action: GRANT_MATCH_SUMMARY_GENERATE_ACTION,
      outcome: 'FAILURE',
      sensitivityLevel: 'RESTRICTED',
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      resourceType: 'grant_match_summary_document',
      resourceId: created.id,
      description: 'Grant match summary generation failed',
      metadata: { documentId: created.id, errorMessage: failureReason },
    });

    throw error;
  }
}

/**
 * Returns the project's latest READY grant match summary, generating one
 * on demand if none exists yet (e.g. a grant application gets APPROVED
 * before the async post-assessment generation job has run). Returns null
 * only if generation itself fails — callers (e.g. the BuilderTrend
 * attachment flow) should treat that as "no attachment available" rather
 * than fail the caller's own action.
 */
export async function getOrGenerateReadyGrantMatchSummary(
  projectId: string,
  actorUserId: string
): Promise<{ s3Key: string; fileName: string } | null> {
  const latest = await prisma.grantMatchSummaryDocument.findFirst({
    where: { projectId, isLatest: true, status: 'READY' },
  });

  if (latest?.s3Key && latest.fileName) {
    return { s3Key: latest.s3Key, fileName: latest.fileName };
  }

  try {
    const result = await generateAndStoreGrantMatchSummaryDocument({ projectId, actorUserId });
    return { s3Key: result.s3Key, fileName: result.fileName };
  } catch (error) {
    console.warn('Failed to generate grant match summary on demand for project', projectId, error);
    return null;
  }
}
