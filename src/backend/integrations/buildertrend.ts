import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "lib/prisma";
import { getObjectBuffer } from "lib/s3";
import { builderTrendTransferQueue } from "@/backend/queue";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { requestManualFallbackExport } from "@/backend/services/manualFallbackExport";
import { getOrGenerateReadyGrantMatchSummary } from "@/backend/services/grantMatchSummaryDocument";
import { getOrGenerateReadyEstimate } from "@/backend/services/estimateDocument";
import {
  assertQuoteAcceptedForWorkOrder,
  logWorkOrderCreationBlocked,
  WorkOrderCreationBlockedError,
} from "@/backend/services/workOrderAcceptance";
import type { BuilderTrendWorkOrderPayload } from "@/backend/integrations/builderTrendPayload";
import { mapBuilderTrendStatus } from "@/backend/integrations/buildertrendStatusMapping";

type TransferRow = {
  id: string;
  projectId: string;
  quoteId: string;
  status: string;
  attempts: number;
  payload: unknown;
};

/** A file attached to the BuilderTrend work order at send time — resolved fresh on every
 * attempt from the Estimate/Grant Match Summary document tables (never persisted on the
 * transfer's own payload column), since PDFs can be (re)generated between attempts. */
export interface ResolvedBuilderTrendAttachment {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * Non-PII summary of the stored transfer payload for audit metadata. The
 * full payload (including client contact info) already lives on the
 * BuilderTrendTransfer row referenced by resourceId, so this is deliberately
 * a shape/field-presence summary rather than a duplicate of the payload
 * itself.
 */
function summarizeBuilderTrendPayloadForAudit(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return { payloadPresent: false };
  }

  const typed = payload as Partial<BuilderTrendWorkOrderPayload>;
  return {
    payloadPresent: true,
    schemaVersion: typed.schemaVersion ?? null,
    hasClientContact: Boolean(typed.client?.name || typed.client?.email || typed.client?.phone),
    modificationType: typed.modificationType ?? [],
    totalEstimate: typed.totalEstimate ?? null,
  };
}

/**
 * Fetches the project owner's Estimate PDF and Grant Match Summary PDF as
 * real file buffers, generating either on demand if not already READY. Best
 * effort, mirroring the pre-restructure attachment behavior: a missing or
 * failed document must never block the transfer itself from sending, so
 * failures here are logged and simply omitted rather than thrown.
 */
export async function resolveBuilderTrendTransferAttachments(transfer: {
  projectId: string;
  quoteId: string;
}): Promise<ResolvedBuilderTrendAttachment[]> {
  const project = await prisma.project.findUnique({
    where: { id: transfer.projectId },
    select: { userId: true },
  });

  if (!project) {
    return [];
  }

  const attachments: ResolvedBuilderTrendAttachment[] = [];

  const estimate = await getOrGenerateReadyEstimate(transfer.quoteId, project.userId);
  if (estimate) {
    try {
      const buffer = await getObjectBuffer(estimate.s3Key);
      attachments.push({ fileName: estimate.fileName, mimeType: "application/pdf", buffer });
    } catch (error) {
      console.warn("Failed to download Estimate PDF for BuilderTrend transfer", transfer.quoteId, error);
    }
  }

  const grantMatchSummary = await getOrGenerateReadyGrantMatchSummary(transfer.projectId, project.userId);
  if (grantMatchSummary) {
    try {
      const buffer = await getObjectBuffer(grantMatchSummary.s3Key);
      attachments.push({ fileName: grantMatchSummary.fileName, mimeType: "application/pdf", buffer });
    } catch (error) {
      console.warn("Failed to download Grant Match Summary PDF for BuilderTrend transfer", transfer.projectId, error);
    }
  }

  return attachments;
}

async function sendMockedBuilderTrendTransfer(
  payload: BuilderTrendWorkOrderPayload,
  attachments: ResolvedBuilderTrendAttachment[]
): Promise<{ externalReference: string }> {
  const shouldFail = (process.env.BUILDERTREND_MOCK_FAIL ?? "false").toLowerCase() === "true";
  if (shouldFail) {
    throw new Error("Mocked BuilderTrend failure (BUILDERTREND_MOCK_FAIL=true)");
  }

  const externalReference = `bt-mock-${Date.now()}-${randomUUID().slice(0, 8)}`;
  console.log("Mocked BuilderTrend transfer sent", {
    externalReference,
    project: payload.project,
    totalEstimate: payload.totalEstimate,
    attachments: attachments.map((attachment) => ({
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.buffer.length,
    })),
  });

  return { externalReference };
}

export async function enqueueBuilderTrendTransfer(transferId: string): Promise<void> {
  await builderTrendTransferQueue.add(
    `buildertrend-transfer:${transferId}`,
    {
      transferId,
    },
    {
      jobId: transferId,
      removeOnComplete: 100,
      removeOnFail: 500,
      priority: 1,
    }
  );
}

export async function retryBuilderTrendTransfer(input: {
  transferId: string;
}): Promise<{ previousStatus: string; alreadyQueued: boolean }> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; status: string; projectId: string; quoteId: string }>
  >(
    Prisma.sql`
      SELECT "id", "status", "projectId", "quoteId"
      FROM "BuilderTrendTransfer"
      WHERE "id" = ${input.transferId}
      LIMIT 1
    `
  );

  if (rows.length === 0) {
    throw new Error(`BuilderTrend transfer ${input.transferId} not found`);
  }

  const transfer = rows[0];
  if (transfer.status === "SENT") {
    throw new Error("Cannot retry a transfer that has already been sent");
  }

  const existingJob = await builderTrendTransferQueue.getJob(transfer.id);
  const existingJobState = existingJob ? await existingJob.getState() : null;
  const isTerminalJobState = existingJobState === "failed" || existingJobState === "completed";
  const alreadyQueued = Boolean(existingJob) && !isTerminalJobState;

  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "BuilderTrendTransfer"
      SET
        "status" = 'PENDING'::"BuilderTrendTransferStatus",
        "lastError" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${transfer.id}
    `
  );

  if (existingJob && isTerminalJobState) {
    // A job with this id already exists but is dead (failed/completed); BullMQ won't
    // create a new one for the same jobId, so move the existing one back to waiting.
    // Reset attemptsMade so a manual retry gets the same full backoff cycle as a
    // fresh transfer, instead of immediately re-exhausting on a single attempt.
    await existingJob.retry(existingJobState as "failed" | "completed", { resetAttemptsMade: true });
  } else if (!existingJob) {
    await enqueueBuilderTrendTransfer(transfer.id);
  }

  return {
    previousStatus: transfer.status,
    alreadyQueued,
  };
}

export async function processBuilderTrendTransfer(
  transferId: string,
  attemptContext: { attemptsMade: number; maxAttempts: number }
): Promise<void> {
  const rows = await prisma.$queryRaw<TransferRow[]>(
    Prisma.sql`
      SELECT
        "id",
        "projectId",
        "quoteId",
        "status",
        "attempts",
        "payload"
      FROM "BuilderTrendTransfer"
      WHERE "id" = ${transferId}
      LIMIT 1
    `
  );

  if (rows.length === 0) {
    throw new Error(`BuilderTrend transfer ${transferId} not found`);
  }

  const transfer = rows[0];
  if (transfer.status === "SENT") {
    return;
  }

  try {
    await assertQuoteAcceptedForWorkOrder(transfer.quoteId);
  } catch (error) {
    const reason = error instanceof WorkOrderCreationBlockedError ? error.reason : "ESTIMATE_NOT_ACCEPTED";

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE "BuilderTrendTransfer"
        SET
          "status" = 'FAILED'::"BuilderTrendTransferStatus",
          "lastError" = ${`Work order creation blocked: ${reason}`},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${transfer.id}
      `
    );

    const quoteSource = await prisma.quote.findUnique({
      where: { id: transfer.quoteId },
      select: { source: true },
    });

    await logWorkOrderCreationBlocked({
      quoteId: transfer.quoteId,
      projectId: transfer.projectId,
      reason,
      source: quoteSource?.source === "MANUAL" ? "MANUAL" : "AUTOMATED",
    });

    return;
  }

  const startedAtMs = Date.now();
  const attemptNumber = attemptContext.attemptsMade + 1;
  const isFinalAttempt = attemptNumber >= attemptContext.maxAttempts;

  try {
    // Re-resolved on every attempt (not cached on the transfer row): a PDF that failed to
    // generate on a prior attempt may be ready by the time this attempt runs, and signed S3
    // content shouldn't be held across retries/backoff.
    const attachments = await resolveBuilderTrendTransferAttachments({
      projectId: transfer.projectId,
      quoteId: transfer.quoteId,
    });
    const result = await sendMockedBuilderTrendTransfer(
      transfer.payload as BuilderTrendWorkOrderPayload,
      attachments
    );

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE "BuilderTrendTransfer"
        SET
          "status" = 'SENT'::"BuilderTrendTransferStatus",
          "attempts" = "attempts" + 1,
          "externalReference" = ${result.externalReference},
          "lastError" = NULL,
          "sentAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${transfer.id}
      `
    );

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "BUILDERTREND_TRANSFER_SENT",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      projectId: transfer.projectId,
      quoteId: transfer.quoteId,
      resourceType: "buildertrend_transfer",
      resourceId: transfer.id,
      description: "BuilderTrend transfer processed successfully",
      metadata: {
        transferStatus: "SENT",
        attemptNumber,
        durationMs: Date.now() - startedAtMs,
        externalReference: result.externalReference,
        attachmentCount: attachments.length,
        attachmentFileNames: attachments.map((attachment) => attachment.fileName),
        ...summarizeBuilderTrendPayloadForAudit(transfer.payload),
      },
    });
  } catch (error) {
    const nextStatus = isFinalAttempt ? "FAILED" : "RETRYING";
    const errorMessage = error instanceof Error ? error.message : "Unknown BuilderTrend transfer error";

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE "BuilderTrendTransfer"
        SET
          "status" = ${nextStatus}::"BuilderTrendTransferStatus",
          "attempts" = "attempts" + 1,
          "lastError" = ${errorMessage},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${transfer.id}
      `
    );

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "BUILDERTREND_TRANSFER_FAILED",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      projectId: transfer.projectId,
      quoteId: transfer.quoteId,
      resourceType: "buildertrend_transfer",
      resourceId: transfer.id,
      description: isFinalAttempt
        ? "BuilderTrend transfer failed on final retry attempt"
        : "BuilderTrend transfer attempt failed, retry scheduled",
      metadata: {
        transferId: transfer.id,
        transferStatus: nextStatus,
        attemptNumber,
        maxAttempts: attemptContext.maxAttempts,
        isFinalAttempt,
        durationMs: Date.now() - startedAtMs,
        errorMessage,
        ...summarizeBuilderTrendPayloadForAudit(transfer.payload),
      },
    });

    throw error;
  }
}

/**
 * Called once a BuilderTrend transfer's job has permanently failed (all retry
 * attempts exhausted). Atomically claims the transfer via the
 * fallbackRequestedAt guard so a manual retry racing with this handler, or a
 * duplicate worker 'failed' event, can't trigger the export more than once.
 */
export async function triggerManualFallbackForExhaustedTransfer(transferId: string): Promise<void> {
  const claimedRows = await prisma.$queryRaw<Array<{ id: string; projectId: string }>>(
    Prisma.sql`
      UPDATE "BuilderTrendTransfer"
      SET "fallbackRequestedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${transferId}
        AND "status" = 'FAILED'::"BuilderTrendTransferStatus"
        AND "fallbackRequestedAt" IS NULL
      RETURNING "id", "projectId"
    `
  );

  if (claimedRows.length === 0) {
    return;
  }

  const transfer = claimedRows[0];

  const project = await prisma.project.findUnique({
    where: { id: transfer.projectId },
    select: {
      id: true,
      userId: true,
      user: { select: { email: true, name: true } },
    },
  });

  if (!project) {
    return;
  }

  const exportRequest = await requestManualFallbackExport({
    projectId: project.id,
    requestedByUserId: project.userId,
    requestedByEmail: project.user.email,
    requestedByName: project.user.name,
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "BUILDERTREND_TRANSFER_FALLBACK_TRIGGERED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    projectId: project.id,
    resourceType: "buildertrend_transfer",
    resourceId: transfer.id,
    description: "BuilderTrend transfer exhausted all retry attempts; manual fallback export triggered automatically",
    metadata: {
      exportRequestId: exportRequest.exportRequestId,
      triggeredBy: "system:buildertrend-retry-exhausted",
    },
  });
}

/* ------------------------------------------------------------------ */
/* Inbound status callbacks (P3-B1)                                    */
/* ------------------------------------------------------------------ */

export type BuilderTrendStatusCallbackErrorCode = "TRANSFER_NOT_FOUND";

export class BuilderTrendStatusCallbackError extends Error {
  code: BuilderTrendStatusCallbackErrorCode;

  constructor(message: string, code: BuilderTrendStatusCallbackErrorCode) {
    super(message);
    this.code = code;
  }
}

export interface BuilderTrendStatusCallbackInput {
  externalReference: string;
  status: string;
  workOrderUrl?: string | null;
  rawPayload: unknown;
}

export interface BuilderTrendStatusCallbackResult {
  callbackEventId: string;
  transferId: string;
  projectId: string;
  previousExternalStatus: string | null;
  newExternalStatus: string;
  previousProjectStatus: string;
  newProjectStatus: string | null;
  mapped: boolean;
}

/**
 * Processes an inbound BuilderTrend work-order status callback: looks up the
 * transfer by externalReference, maps BuilderTrend's status vocabulary to an
 * internal Project.status, updates the transfer/project, and logs the event
 * (both a dedicated BuilderTrendStatusCallbackEvent row and an AuditEvent) —
 * regardless of whether the incoming status was recognized, so every
 * callback is auditable.
 */
export async function processBuilderTrendStatusCallback(
  input: BuilderTrendStatusCallbackInput
): Promise<BuilderTrendStatusCallbackResult> {
  const transfer = await prisma.builderTrendTransfer.findFirst({
    where: { externalReference: input.externalReference },
    select: {
      id: true,
      projectId: true,
      externalStatus: true,
      project: { select: { id: true, status: true } },
    },
  });

  if (!transfer) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "BUILDERTREND_STATUS_CALLBACK_UNMATCHED",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      resourceType: "buildertrend_callback",
      resourceId: input.externalReference,
      description: "BuilderTrend status callback received for an unknown externalReference",
      metadata: { externalReference: input.externalReference, status: input.status },
    });

    throw new BuilderTrendStatusCallbackError(
      `No BuilderTrend transfer found for externalReference "${input.externalReference}"`,
      "TRANSFER_NOT_FOUND"
    );
  }

  const previousExternalStatus = transfer.externalStatus;
  const previousProjectStatus = transfer.project.status;
  const mappedStatus = mapBuilderTrendStatus(input.status);
  const now = new Date();

  await prisma.builderTrendTransfer.update({
    where: { id: transfer.id },
    data: {
      externalStatus: input.status,
      lastStatusCallbackAt: now,
      ...(input.workOrderUrl ? { workOrderUrl: input.workOrderUrl } : {}),
    },
  });

  if (mappedStatus && mappedStatus !== previousProjectStatus) {
    await prisma.project.update({
      where: { id: transfer.projectId },
      data: { status: mappedStatus },
    });
  }

  const callbackEvent = await prisma.builderTrendStatusCallbackEvent.create({
    data: {
      projectId: transfer.projectId,
      builderTrendTransferId: transfer.id,
      externalReference: input.externalReference,
      previousStatus: previousExternalStatus,
      newStatus: input.status,
      previousProjectStatus,
      newProjectStatus: mappedStatus,
      rawPayload: input.rawPayload as Prisma.InputJsonValue,
      validationError: mappedStatus ? null : `Unrecognized BuilderTrend status: "${input.status}"`,
      processedAt: now,
    },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "BUILDERTREND_STATUS_CALLBACK_RECEIVED",
    outcome: mappedStatus ? "SUCCESS" : "FAILURE",
    sensitivityLevel: "RESTRICTED",
    projectId: transfer.projectId,
    resourceType: "buildertrend_transfer",
    resourceId: transfer.id,
    description: mappedStatus
      ? "BuilderTrend status callback processed and mapped to project status"
      : "BuilderTrend status callback received with an unrecognized status; project status unchanged",
    beforeState: { externalStatus: previousExternalStatus, projectStatus: previousProjectStatus },
    afterState: { externalStatus: input.status, projectStatus: mappedStatus ?? previousProjectStatus },
    metadata: { callbackEventId: callbackEvent.id, workOrderUrl: input.workOrderUrl ?? null },
  });

  return {
    callbackEventId: callbackEvent.id,
    transferId: transfer.id,
    projectId: transfer.projectId,
    previousExternalStatus,
    newExternalStatus: input.status,
    previousProjectStatus,
    newProjectStatus: mappedStatus,
    mapped: mappedStatus !== null,
  };
}

/**
 * Staff-driven fallback for when BuilderTrend doesn't support callbacks:
 * records that a human confirmed the work order's status out-of-band, so the
 * dashboard can show "last manually synced at <time>" instead of a live
 * status.
 */
export async function recordBuilderTrendManualSync(input: {
  transferId: string;
  actorUserId: string;
}): Promise<{ transferId: string; lastManualSyncAt: Date }> {
  const transfer = await prisma.builderTrendTransfer.findUnique({
    where: { id: input.transferId },
    select: { id: true, projectId: true, quoteId: true },
  });

  if (!transfer) {
    throw new BuilderTrendStatusCallbackError("BuilderTrend transfer not found", "TRANSFER_NOT_FOUND");
  }

  const now = new Date();

  await prisma.builderTrendTransfer.update({
    where: { id: transfer.id },
    data: { lastManualSyncAt: now, lastManualSyncByUserId: input.actorUserId },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "BUILDERTREND_TRANSFER_MANUAL_SYNC",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId,
    projectId: transfer.projectId,
    quoteId: transfer.quoteId,
    resourceType: "buildertrend_transfer",
    resourceId: transfer.id,
    description: "Staff manually confirmed BuilderTrend work order sync",
    metadata: { lastManualSyncAt: now.toISOString() },
  });

  return { transferId: transfer.id, lastManualSyncAt: now };
}

export interface TriggerBuilderTrendTransferResult {
  triggered: boolean;
  transferId: string | null;
}

/**
 * The approval gate: a BuilderTrendTransfer row is created as soon as a
 * quote is accepted (see quote/[id]/respond/route.ts and
 * manualMode.ts), but is only *enqueued* for sending once the project's
 * status has been transitioned to APPROVED — those two triggers race
 * independently, so both directions are covered: quote acceptance enqueues
 * immediately if the project is already APPROVED by then, and this covers the
 * case where approval comes after the transfer row already exists. No-ops
 * (not an error) when no transfer exists yet, or when it's already past
 * PENDING (already enqueued/sent/failed) — enqueueBuilderTrendTransfer is
 * itself idempotent per transferId, but this check avoids adding a
 * duplicate audit trail entry for every subsequent status read.
 */
export async function triggerBuilderTrendTransferForApprovedProject(
  projectId: string,
  actorUserId: string
): Promise<TriggerBuilderTrendTransferResult> {
  const transfer = await prisma.builderTrendTransfer.findFirst({
    where: { projectId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true, quoteId: true },
  });

  if (!transfer) {
    return { triggered: false, transferId: null };
  }

  await enqueueBuilderTrendTransfer(transfer.id);

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "BUILDERTREND_TRANSFER_TRIGGERED_BY_PROJECT_APPROVAL",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId,
    projectId,
    quoteId: transfer.quoteId,
    resourceType: "buildertrend_transfer",
    resourceId: transfer.id,
    description: "BuilderTrend transfer enqueued now that the project has been approved",
  });

  return { triggered: true, transferId: transfer.id };
}

export interface AttachGrantMatchSummaryResult {
  attached: boolean;
  transferId: string | null;
}

/**
 * Eagerly (re)generates the project's Grant Match Summary PDF on project
 * approval, so it's already READY by the time the BuilderTrend transfer's
 * attachments are resolved. Since attachments are now resolved fresh from
 * the document tables at send time (see
 * resolveBuilderTrendTransferAttachments), this no longer needs to patch the
 * transfer's stored payload directly — approval and quote acceptance can
 * happen in either order, and send-time resolution picks up whichever
 * document is READY regardless of which happened first. No transfer yet is
 * not an error: the summary will be picked up naturally whenever the
 * transfer is eventually created and sent.
 */
export async function attachGrantMatchSummaryToBuilderTrendTransfer(
  projectId: string,
  actorUserId: string
): Promise<AttachGrantMatchSummaryResult> {
  const transfer = await prisma.builderTrendTransfer.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true, projectId: true, quoteId: true },
  });

  if (!transfer) {
    return { attached: false, transferId: null };
  }

  const summary = await getOrGenerateReadyGrantMatchSummary(projectId, actorUserId);
  if (!summary) {
    return { attached: false, transferId: transfer.id };
  }

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "BUILDERTREND_TRANSFER_ATTACHMENT_ADDED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId,
    projectId: transfer.projectId,
    quoteId: transfer.quoteId,
    resourceType: "buildertrend_transfer",
    resourceId: transfer.id,
    description: "Grant Match Summary generated/refreshed ahead of BuilderTrend work order attachment resolution",
    metadata: { fileName: summary.fileName, s3Key: summary.s3Key },
  });

  return { attached: true, transferId: transfer.id };
}