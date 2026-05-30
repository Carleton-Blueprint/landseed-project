import { NextRequest, NextResponse } from "next/server";
import { NotificationEventType, QuoteStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { getRequestAuditContext, logAuditEventNonBlocking } from "@/backend/audit/log";
import { enqueueNotification } from "@/backend/notifications/enqueue";

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
        action: "ESTIMATE_REACTIVATE_ATTEMPT",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Unauthenticated estimate reactivation attempt",
        ...requestContext,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (process.env.NODE_ENV === "development") {
      return NextResponse.json({
        success: true,
        quote: {
          id: resolvedParams.id,
          status: "PENDING",
          lastClientActivityAt: new Date().toISOString(),
        }
      }, { status: 200 });
    }

    const quote = await prisma.quote.findUnique({
      where: { id: resolvedParams.id },
      include: {
        project: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            projectAccess: {
              where: { userId: session.user.id },
            },
          },
        },
      },
    });

    if (!quote) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "ESTIMATE_REACTIVATE_ATTEMPT",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Estimate reactivation attempted for non-existent quote",
        ...requestContext,
      });
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (quote.project.projectAccess.length === 0) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "ESTIMATE_REACTIVATE_ATTEMPT",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId: quote.projectId,
        quoteId: quote.id,
        resourceType: "quote",
        resourceId: quote.id,
        description: "Estimate reactivation denied due to missing project access",
        ...requestContext,
      });
      return NextResponse.json({ error: "Forbidden: You don't have access to this quote" }, { status: 403 });
    }

    if (quote.status !== QuoteStatus.EXPIRED) {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "ESTIMATE_REACTIVATE_ATTEMPT",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId: quote.projectId,
        quoteId: quote.id,
        resourceType: "quote",
        resourceId: quote.id,
        description: "Estimate reactivation rejected because quote is not expired",
        metadata: {
          currentStatus: quote.status,
        },
        ...requestContext,
      });
      return NextResponse.json(
        { error: "Only expired estimates can be reactivated" },
        { status: 409 }
      );
    }

    const reactivatedQuote = await prisma.$transaction(async (tx) => {
      const updatedQuote = await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: QuoteStatus.PENDING,
          lastClientActivityAt: new Date(),
        },
        select: {
          id: true,
          projectId: true,
          status: true,
          lastClientActivityAt: true,
        },
      });

      await tx.project.update({
        where: { id: quote.projectId },
        data: {
          status: "estimate_ready",
        },
      });

      return updatedQuote;
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ESTIMATE_REACTIVATED",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId: quote.projectId,
      quoteId: quote.id,
      resourceType: "quote",
      resourceId: quote.id,
      description: "Client reactivated expired estimate",
      beforeState: {
        quoteStatus: quote.status,
        projectStatus: quote.project.status,
      },
      afterState: {
        quoteStatus: reactivatedQuote.status,
        projectStatus: "estimate_ready",
        lastClientActivityAt: reactivatedQuote.lastClientActivityAt,
      },
      ...requestContext,
    });

    if (quote.project.user?.email) {
      const estimateBaseUrl =
        process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

      try {
        await enqueueNotification({
          eventType: NotificationEventType.ESTIMATE_REACTIVATED,
          idempotencyKey: `estimate-reactivated:${quote.id}:${reactivatedQuote.lastClientActivityAt.getTime()}`,
          recipientEmail: quote.project.user.email,
          recipientName: quote.project.user.name,
          userId: quote.project.user.id,
          projectId: quote.projectId,
          projectAddress: quote.project.address,
          estimateLink: `${estimateBaseUrl}/projects/${quote.projectId}/estimate`,
        });
      } catch (enqueueError) {
        await logAuditEventNonBlocking({
          category: "MANUAL_CHANGE",
          action: "ESTIMATE_REACTIVATED_NOTIFICATION_ENQUEUE_FAILED",
          outcome: "FAILURE",
          sensitivityLevel: "RESTRICTED",
          actorUserId: session.user.id,
          projectId: quote.projectId,
          quoteId: quote.id,
          resourceType: "notification_delivery",
          resourceId: quote.id,
          description: "Failed to enqueue estimate reactivated notification",
          metadata: {
            errorMessage:
              enqueueError instanceof Error
                ? enqueueError.message
                : "Unknown enqueue error",
          },
          ...requestContext,
        });
      }
    }

    return NextResponse.json(
      {
        success: true,
        quote: {
          id: reactivatedQuote.id,
          status: reactivatedQuote.status,
          lastClientActivityAt: reactivatedQuote.lastClientActivityAt,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ESTIMATE_REACTIVATED",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      quoteId: resolvedParams.id,
      resourceType: "quote",
      resourceId: resolvedParams.id,
      description: "Estimate reactivation failed due to internal error",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      ...requestContext,
    });

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}