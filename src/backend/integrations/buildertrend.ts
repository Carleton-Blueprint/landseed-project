import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "lib/prisma";
import { builderTrendTransferQueue } from "@/backend/queue";

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

export async function processBuilderTrendTransfer(transferId: string): Promise<void> {
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
  } catch (error) {
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE "BuilderTrendTransfer"
        SET
          "status" = 'FAILED'::"BuilderTrendTransferStatus",
          "attempts" = "attempts" + 1,
          "lastError" = ${error instanceof Error ? error.message : "Unknown BuilderTrend transfer error"},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${transfer.id}
      `
    );

    throw error;
  }
}
