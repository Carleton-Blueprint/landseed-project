import { NextRequest, NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { getRequestAuditContext, logAuditEventNonBlocking } from "@/backend/audit/log";

export async function GET(
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
        attempts: true,
        requestedAt: true,
        sentAt: true,
        lastError: true,
        externalReference: true,
        updatedAt: true,
      },
    });

    if (!transfer) {
      return NextResponse.json({ error: "BuilderTrend transfer not found" }, { status: 404 });
    }

    const canAccess = await hasProjectAccess(session.user.id, transfer.projectId);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "BUILDERTREND_TRANSFER_VIEW",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId: transfer.projectId,
      quoteId: transfer.quoteId,
      resourceType: "buildertrend_transfer",
      resourceId: transfer.id,
      description: "Viewed BuilderTrend transfer status",
      metadata: {
        status: transfer.status,
        attempts: transfer.attempts,
      },
      ...requestContext,
    });

    return NextResponse.json({ transfer }, { status: 200 });
  } catch (error) {
    console.error("BuilderTrend transfer status error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
