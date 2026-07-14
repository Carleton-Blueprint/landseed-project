import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "lib/prisma";
import { builderTrendTransferQueue } from "@/backend/queue";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { requestManualFallbackExport } from "@/backend/services/manualFallbackExport";

type TransferRow = {
  id: string;
  projectId: string;
  quoteId: string;
  status: string;
  attempts: number;
  payload: unknown;
};

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
