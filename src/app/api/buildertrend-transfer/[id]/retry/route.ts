import { NextRequest, NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { retryBuilderTrendTransfer } from "@/backend/integrations/buildertrend";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestContext = getRequestAuditContext(req);
  const { id: transferId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const transfer = await prisma.builderTrendTransfer.findUnique({
      where: { id: transferId },
      select: {
        id: true,
        projectId: true,
        quoteId: true,
        status: true,
      },
    });

    if (!transfer) {
      return NextResponse.json({ error: "BuilderTrend transfer not found" }, { status: 404 });
    }

    const canAccess = await hasProjectAccess(session.user.id, transfer.projectId);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (transfer.status === "SENT") {
      return NextResponse.json(
        { error: "Transfer already sent and cannot be retried" },
        { status: 409 }
      );
    }

    const retryResult = await retryBuilderTrendTransfer({ transferId: transfer.id });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "BUILDERTREND_TRANSFER_RETRY_REQUESTED",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId: transfer.projectId,
      quoteId: transfer.quoteId,
      resourceType: "buildertrend_transfer",
      resourceId: transfer.id,
      description: "Manual retry requested for BuilderTrend transfer",
      metadata: {
        previousStatus: retryResult.previousStatus,
        alreadyQueued: retryResult.alreadyQueued,
      },
      ...requestContext,
    });

    return NextResponse.json(
      {
        success: true,
        transferId: transfer.id,
        previousStatus: retryResult.previousStatus,
        alreadyQueued: retryResult.alreadyQueued,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("BuilderTrend transfer retry error:", error);

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "BUILDERTREND_TRANSFER_RETRY_REQUESTED",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      actorUserId: undefined,
      resourceType: "buildertrend_transfer",
      resourceId: transferId,
      description: "Manual retry request for BuilderTrend transfer failed",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown retry error",
      },
      ...requestContext,
    });

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
