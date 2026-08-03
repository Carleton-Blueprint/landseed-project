import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "lib/prisma";
import { builderTrendTransferQueue } from "@/backend/queue";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { requestManualFallbackExport } from "@/backend/services/manualFallbackExport";
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
    lineItemCount: typed.quote?.pricing?.lineItems?.length ?? 0,
    photoCount: typed.photos?.length ?? 0,
  };
}

async function sendMockedBuilderTrendTransfer(): Promise<{ externalReference: string }> {
  const shouldFail = (process.env.BUILDERTREND_MOCK_FAIL ?? "false").toLowerCase() === "true";
  if (shouldFail) {
    throw new Error("Mocked BuilderTrend failure (BUILDERTREND_MOCK_FAIL=true)");
  }

  const externalReference = `bt-mock-${Date.now()}-${randomUUID().slice(0, 8)}`;
  console.log("Mocked BuilderTrend transfer sent", {
    externalReference,
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

  const startedAtMs = Date.now();
  const attemptNumber = attemptContext.attemptsMade + 1;
  const isFinalAttempt = attemptNumber >= attemptContext.maxAttempts;

  try {
    const result = await sendMockedBuilderTrendTransfer();

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