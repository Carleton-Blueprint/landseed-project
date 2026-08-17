import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export type WorkOrderCreationBlockedReason =
  | "QUOTE_NOT_FOUND"
  | "ESTIMATE_NOT_ACCEPTED"
  | "ESTIMATE_DECLINED"
  | "ESTIMATE_EXPIRED";

const REASON_MESSAGES: Record<WorkOrderCreationBlockedReason, string> = {
  QUOTE_NOT_FOUND: "Estimate not found",
  ESTIMATE_NOT_ACCEPTED: "Client acceptance is required before a work order can be created",
  ESTIMATE_DECLINED: "Cannot create a work order for a declined estimate",
  ESTIMATE_EXPIRED: "Cannot create a work order for an expired estimate",
};

export class WorkOrderCreationBlockedError extends Error {
  reason: WorkOrderCreationBlockedReason;

  constructor(reason: WorkOrderCreationBlockedReason) {
    super(REASON_MESSAGES[reason]);
    this.reason = reason;
  }
}

function reasonForStatus(status: string): WorkOrderCreationBlockedReason {
  switch (status) {
    case "DECLINED":
      return "ESTIMATE_DECLINED";
    case "EXPIRED":
      return "ESTIMATE_EXPIRED";
    default:
      return "ESTIMATE_NOT_ACCEPTED";
  }
}

export interface AcceptedQuoteForWorkOrder {
  id: string;
  projectId: string;
  status: string;
}

export async function assertQuoteAcceptedForWorkOrder(quoteId: string): Promise<AcceptedQuoteForWorkOrder> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { id: true, projectId: true, status: true },
  });

  if (!quote) {
    throw new WorkOrderCreationBlockedError("QUOTE_NOT_FOUND");
  }

  if (quote.status !== "ACCEPTED") {
    throw new WorkOrderCreationBlockedError(reasonForStatus(quote.status));
  }

  return quote;
}

export interface LogWorkOrderCreationBlockedInput {
  quoteId: string;
  projectId?: string | null;
  reason: WorkOrderCreationBlockedReason;
  source: "AUTOMATED" | "MANUAL";
  actorUserId?: string | null;
}

export async function logWorkOrderCreationBlocked(input: LogWorkOrderCreationBlockedInput): Promise<void> {
  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "WORK_ORDER_CREATION_BLOCKED",
    outcome: "DENIED",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId ?? null,
    projectId: input.projectId ?? null,
    quoteId: input.quoteId,
    resourceType: "buildertrend_transfer",
    resourceId: input.quoteId,
    description: `Blocked BuilderTrend work order creation: ${REASON_MESSAGES[input.reason]}`,
    metadata: {
      reason: input.reason,
      source: input.source,
    },
  });
}
