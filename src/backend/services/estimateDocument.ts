import { createHash } from 'crypto';
import { prisma } from 'lib/prisma';
import { uploadToS3 } from 'lib/s3';
import { logAuditEventNonBlocking } from '@/backend/audit/log';
import { assembleEstimateInput, AssembledEstimateInput } from './estimateAssembler';
import { generateEstimatePdf } from './estimatePdf';

export interface GenerateAndStoreEstimateDocumentInput {
  quoteId: string;
  actorUserId: string;
  /** Bypass the "skip if nothing relevant changed" check (e.g. an admin-triggered manual regenerate). */
  force?: boolean;
}

export interface GenerateAndStoreEstimateDocumentResult {
  documentId: string;
  projectId: string;
  quoteId: string;
  s3Key: string;
  fileName: string;
  /** False when generation was skipped because no relevant field changed since the last version. */
  regenerated: boolean;
}

const ESTIMATE_DOCUMENT_GENERATE_ACTION = 'QUOTE_ESTIMATE_DOCUMENT_GENERATE';

// Fingerprints the fields that actually appear on the document. preparedAtIso
// is deliberately excluded so re-running this with no real change doesn't
// churn out a new S3 version every time (mirrors grantMatchSummaryDocument.ts).
function computeContentHash(assembled: AssembledEstimateInput): string {
  const relevantFields = {
    clientName: assembled.clientName,
    projectAddress: assembled.projectAddress,
    modificationType: assembled.modificationType,
    selectedTier: assembled.selectedTier,
    pricing: assembled.pricing,
    incompleteFields: assembled.incompleteFields,
  };
  return createHash('sha256').update(JSON.stringify(relevantFields)).digest('hex');
}

export async function generateAndStoreEstimateDocument(
  input: GenerateAndStoreEstimateDocumentInput
): Promise<GenerateAndStoreEstimateDocumentResult> {
  const assembled = await assembleEstimateInput(input.quoteId);
  const contentHash = computeContentHash(assembled);

  const latest = await prisma.estimateDocument.findFirst({
    where: { quoteId: input.quoteId, isLatest: true },
  });

  if (!input.force && latest?.status === 'READY' && latest.contentHash === contentHash && latest.s3Key && latest.fileName) {
    await logAuditEventNonBlocking({
      category: 'MANUAL_CHANGE',
      action: ESTIMATE_DOCUMENT_GENERATE_ACTION,
      outcome: 'SUCCESS',
      sensitivityLevel: 'RESTRICTED',
      actorUserId: input.actorUserId,
      projectId: assembled.projectId,
      quoteId: input.quoteId,
      resourceType: 'estimate_document',
      resourceId: latest.id,
      description: 'Estimate document generation skipped: no relevant fields changed since last version',
      metadata: { documentId: latest.id, s3Key: latest.s3Key, contentHash, skipped: true },
    });

    return {
      documentId: latest.id,
      projectId: assembled.projectId,
      quoteId: input.quoteId,
      s3Key: latest.s3Key,
      fileName: latest.fileName,
      regenerated: false,
    };
  }

  const version = (latest?.version ?? 0) + 1;
  const fileName = `estimate-v${version}.pdf`;
  const s3Key = `projects/${assembled.projectId}/estimate/${fileName}`;

  if (latest) {
    await prisma.estimateDocument.update({
      where: { id: latest.id },
      data: { isLatest: false },
    });
  }

  const created = await prisma.estimateDocument.create({
    data: {
      projectId: assembled.projectId,
      quoteId: input.quoteId,
      status: 'PENDING',
      contentHash,
      version,
      isLatest: true,
      requestedAt: new Date(),
    },
  });

  try {
    const pdfBuffer = await generateEstimatePdf(assembled);
    await uploadToS3(pdfBuffer, s3Key, 'application/pdf');

    await prisma.estimateDocument.update({
      where: { id: created.id },
      data: { status: 'READY', s3Key, fileName, readyAt: new Date() },
    });

    await logAuditEventNonBlocking({
      category: 'MANUAL_CHANGE',
      action: ESTIMATE_DOCUMENT_GENERATE_ACTION,
      outcome: 'SUCCESS',
      sensitivityLevel: 'RESTRICTED',
      actorUserId: input.actorUserId,
      projectId: assembled.projectId,
      quoteId: input.quoteId,
      resourceType: 'estimate_document',
      resourceId: created.id,
      description: 'Estimate document generated, uploaded, and stored',
      metadata: {
        documentId: created.id,
        s3Key,
        version,
        contentHash,
        lineItemCount: assembled.pricing.lineItems.length,
        total: assembled.pricing.total,
        incompleteFields: assembled.incompleteFields,
      },
    });

    return { documentId: created.id, projectId: assembled.projectId, quoteId: input.quoteId, s3Key, fileName, regenerated: true };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : 'Unknown error';

    await prisma.estimateDocument.update({
      where: { id: created.id },
      data: { status: 'FAILED', failureReason },
    });

    await logAuditEventNonBlocking({
      category: 'MANUAL_CHANGE',
      action: ESTIMATE_DOCUMENT_GENERATE_ACTION,
      outcome: 'FAILURE',
      sensitivityLevel: 'RESTRICTED',
      actorUserId: input.actorUserId,
      projectId: assembled.projectId,
      quoteId: input.quoteId,
      resourceType: 'estimate_document',
      resourceId: created.id,
      description: 'Estimate document generation failed',
      metadata: { documentId: created.id, errorMessage: failureReason },
    });

    throw error;
  }
}

/**
 * Returns the quote's latest READY estimate document, generating one on
 * demand if none exists yet (e.g. a quote gets accepted and approved before
 * any async job has generated its estimate document). Returns null only if
 * generation itself fails — callers (e.g. the manual fallback export flow)
 * should treat that as "no attachment available" rather than fail the
 * caller's own action.
 */
export async function getOrGenerateReadyEstimate(
  quoteId: string,
  actorUserId: string
): Promise<{ s3Key: string; fileName: string } | null> {
  const latest = await prisma.estimateDocument.findFirst({
    where: { quoteId, isLatest: true, status: 'READY' },
  });

  if (latest?.s3Key && latest.fileName) {
    return { s3Key: latest.s3Key, fileName: latest.fileName };
  }

  try {
    const result = await generateAndStoreEstimateDocument({ quoteId, actorUserId });
    return { s3Key: result.s3Key, fileName: result.fileName };
  } catch (error) {
    console.warn('Failed to generate estimate document on demand for quote', quoteId, error);
    return null;
  }
}
