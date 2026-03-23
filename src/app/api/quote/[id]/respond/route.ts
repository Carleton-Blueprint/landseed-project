import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { getRequestAuditContext, logAuditEventNonBlocking } from "@/backend/audit/log";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestContext = getRequestAuditContext(req);
  const resolvedParams = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "QUOTE_RESPONSE_ATTEMPT",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Unauthenticated quote response attempt",
        ...requestContext,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { status, reason } = body;

    // Validate inputs
    if (status !== "ACCEPTED" && status !== "DECLINED") {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "ESTIMATE_STATUS_CHANGE",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Rejected estimate status update due to invalid status",
        metadata: { providedStatus: status },
        ...requestContext,
      });
      return NextResponse.json({ error: "Invalid status provided" }, { status: 400 });
    }
    if (status === "DECLINED" && (!reason || typeof reason !== "string")) {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "ESTIMATE_STATUS_CHANGE",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Rejected decline update due to missing reason",
        metadata: { providedReasonType: typeof reason },
        ...requestContext,
      });
      return NextResponse.json({ error: "A valid reason is required when declining" }, { status: 400 });
    }

    // Fetch the quote and its related project access
    const quote = await prisma.quote.findUnique({
      where: { id: resolvedParams.id },
      include: {
        project: {
          include: {
            projectAccess: {
              where: { userId: session.user.id }
            }
          }
        }
      }
    });

    if (!quote) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "QUOTE_RESPONSE_ATTEMPT",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Quote response attempted for non-existent quote",
        ...requestContext,
      });
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    // Check if the user has access to this project
    if (quote.project.projectAccess.length === 0) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "QUOTE_RESPONSE_ATTEMPT",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId: quote.projectId,
        quoteId: quote.id,
        resourceType: "quote",
        resourceId: quote.id,
        description: "Quote response denied due to missing project access",
        ...requestContext,
      });
      return NextResponse.json({ error: "Forbidden: You don't have access to this quote" }, { status: 403 });
    }

    // Process the update
    const updatedProjectStatus = status === "ACCEPTED" ? "estimate_accepted" : "estimate_declined";

    // Update Quote status and Project status in a transaction
    const updatedQuote = await prisma.$transaction(async (tx) => {
      const updatedRows = await tx.$queryRaw<Array<{ id: string; status: string; declinedReason: string | null }>>(
        Prisma.sql`
          UPDATE "Quote"
          SET
            "status" = ${status}::"QuoteStatus",
            "declinedReason" = ${status === "DECLINED" ? reason : null},
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${quote.id}
          RETURNING "id", "status", "declinedReason"
        `
      );

      await tx.project.update({
        where: { id: quote.projectId },
        data: {
          status: updatedProjectStatus,
          // Optional: we can store structured decline data in project draftData too
        }
      });

      if (updatedRows.length === 0) {
        throw new Error("Quote update failed");
      }

      return updatedRows[0];
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ESTIMATE_STATUS_CHANGE",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId: quote.projectId,
      quoteId: quote.id,
      resourceType: "quote",
      resourceId: quote.id,
      reason: status === "DECLINED" ? reason : null,
      description: "Manual estimate status updated",
      beforeState: {
        projectStatus: quote.project.status,
      },
      afterState: {
        status: updatedQuote.status,
        declinedReason: updatedQuote.declinedReason,
        projectStatus: updatedProjectStatus,
      },
      ...requestContext,
    });

    return NextResponse.json({ success: true, quote: updatedQuote }, { status: 200 });
  } catch (error: unknown) {
    console.error("Quote response error:", error);

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ESTIMATE_STATUS_CHANGE",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      quoteId: resolvedParams.id,
      resourceType: "quote",
      resourceId: resolvedParams.id,
      description: "Estimate status update failed due to internal error",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      ...requestContext,
    });

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
