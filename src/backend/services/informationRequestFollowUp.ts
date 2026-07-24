import { InformationRequestStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

const DEFAULT_FOLLOW_UP_DAYS = 7;
const DEFAULT_BATCH_SIZE = 200;

type FlagStaleInformationRequestsOptions = {
  now?: Date;
  followUpDays?: number;
  batchSize?: number;
};

type FlagStaleInformationRequestsBatchResult = {
  cutoffAt: Date;
  scanned: number;
  flagged: number;
};

export type FlagStaleInformationRequestsResult = {
  cutoffAt: Date;
  scanned: number;
  flagged: number;
  batches: number;
};

function getCutoff(now: Date, followUpDays: number): Date {
  return new Date(now.getTime() - followUpDays * 24 * 60 * 60 * 1000);
}

async function flagStaleInformationRequestsBatch(
  options: FlagStaleInformationRequestsOptions = {}
): Promise<FlagStaleInformationRequestsBatchResult> {
  const now = options.now ?? new Date();
  const followUpDays = options.followUpDays ?? DEFAULT_FOLLOW_UP_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const cutoffAt = getCutoff(now, followUpDays);

  const staleRequests = await prisma.informationRequest.findMany({
    where: {
      status: InformationRequestStatus.PENDING,
      createdAt: { lte: cutoffAt },
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true, projectId: true, requestType: true, createdAt: true },
  });

  if (staleRequests.length === 0) {
    return { cutoffAt, scanned: 0, flagged: 0 };
  }

  const ids = staleRequests.map((r) => r.id);

  await prisma.informationRequest.updateMany({
    where: { id: { in: ids } },
    data: { status: InformationRequestStatus.FOLLOW_UP_FLAGGED, followUpFlaggedAt: now },
  });

  await Promise.all(
    staleRequests.map((request) =>
      logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "INFORMATION_REQUEST_FOLLOW_UP_FLAGGED",
        outcome: "SUCCESS",
        sensitivityLevel: "CONFIDENTIAL",
        projectId: request.projectId,
        resourceType: "InformationRequest",
        resourceId: request.id,
        description: `Information request unanswered after ${followUpDays} days; flagged for staff follow-up`,
        beforeState: { status: InformationRequestStatus.PENDING },
        afterState: { status: InformationRequestStatus.FOLLOW_UP_FLAGGED, followUpFlaggedAt: now },
        metadata: { requestType: request.requestType, createdAt: request.createdAt, cutoffAt },
      })
    )
  );

  return { cutoffAt, scanned: staleRequests.length, flagged: staleRequests.length };
}

export async function flagStaleInformationRequests(
  options: FlagStaleInformationRequestsOptions = {}
): Promise<FlagStaleInformationRequestsResult> {
  const now = options.now ?? new Date();
  const followUpDays = options.followUpDays ?? DEFAULT_FOLLOW_UP_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  let totalScanned = 0;
  let totalFlagged = 0;
  let batches = 0;
  const cutoffAt = getCutoff(now, followUpDays);

  while (true) {
    const batch = await flagStaleInformationRequestsBatch({ now, followUpDays, batchSize });
    batches += 1;
    totalScanned += batch.scanned;
    totalFlagged += batch.flagged;

    if (batch.flagged < batchSize) {
      break;
    }
  }

  return { cutoffAt, scanned: totalScanned, flagged: totalFlagged, batches };
}
