import { QuoteStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

const DEFAULT_INACTIVITY_DAYS = 30;
const DEFAULT_BATCH_SIZE = 200;

type ExpireInactiveQuotesOptions = {
  now?: Date;
  inactivityDays?: number;
  batchSize?: number;
};

type ExpireInactiveQuotesBatchResult = {
  cutoffAt: Date;
  scanned: number;
  expired: number;
  quoteIds: string[];
};

export type ExpireInactiveQuotesResult = {
  cutoffAt: Date;
  scanned: number;
  expired: number;
  batches: number;
};

function getCutoff(now: Date, inactivityDays: number): Date {
  return new Date(now.getTime() - inactivityDays * 24 * 60 * 60 * 1000);
}

async function expireInactiveQuotesBatch(
  options: ExpireInactiveQuotesOptions = {}
): Promise<ExpireInactiveQuotesBatchResult> {
  const now = options.now ?? new Date();
  const inactivityDays = options.inactivityDays ?? DEFAULT_INACTIVITY_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const cutoffAt = getCutoff(now, inactivityDays);

  const staleQuotes = await prisma.quote.findMany({
    where: {
      status: QuoteStatus.PENDING,
      lastClientActivityAt: { lte: cutoffAt },
    },
    orderBy: { lastClientActivityAt: "asc" },
    take: batchSize,
    select: {
      id: true,
      projectId: true,
      status: true,
      lastClientActivityAt: true,
      project: {
        select: {
          status: true,
        },
      },
    },
  });

  if (staleQuotes.length === 0) {
    return {
      cutoffAt,
      scanned: 0,
      expired: 0,
      quoteIds: [],
    };
  }

  const quoteIds = staleQuotes.map((quote) => quote.id);
  const uniqueProjectIds = [...new Set(staleQuotes.map((quote) => quote.projectId))];

  await prisma.$transaction(async (tx) => {
    await tx.quote.updateMany({
      where: { id: { in: quoteIds } },
      data: {
        status: QuoteStatus.EXPIRED,
      },
    });

    await tx.project.updateMany({
      where: { id: { in: uniqueProjectIds } },
      data: {
        status: "estimate_expired",
      },
    });
  });

  await Promise.all(
    staleQuotes.map((quote) =>
      logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "ESTIMATE_AUTO_EXPIRED",
        outcome: "SUCCESS",
        sensitivityLevel: "RESTRICTED",
        projectId: quote.projectId,
        quoteId: quote.id,
        resourceType: "quote",
        resourceId: quote.id,
        description: "Estimate automatically marked as expired after inactivity window",
        beforeState: {
          quoteStatus: quote.status,
          projectStatus: quote.project.status,
          lastClientActivityAt: quote.lastClientActivityAt,
        },
        afterState: {
          quoteStatus: QuoteStatus.EXPIRED,
          projectStatus: "estimate_expired",
          expiredAt: now,
          inactivityCutoffAt: cutoffAt,
        },
      })
    )
  );

  return {
    cutoffAt,
    scanned: staleQuotes.length,
    expired: staleQuotes.length,
    quoteIds,
  };
}

export async function expireInactiveQuotes(
  options: ExpireInactiveQuotesOptions = {}
): Promise<ExpireInactiveQuotesResult> {
  const now = options.now ?? new Date();
  const inactivityDays = options.inactivityDays ?? DEFAULT_INACTIVITY_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  let totalScanned = 0;
  let totalExpired = 0;
  let batches = 0;
  const cutoffAt = getCutoff(now, inactivityDays);

  while (true) {
    const batch = await expireInactiveQuotesBatch({ now, inactivityDays, batchSize });
    batches += 1;
    totalScanned += batch.scanned;
    totalExpired += batch.expired;

    if (batch.expired < batchSize) {
      break;
    }
  }

  return {
    cutoffAt,
    scanned: totalScanned,
    expired: totalExpired,
    batches,
  };
}