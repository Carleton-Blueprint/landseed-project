import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import {
  GrantLifecycleTransitionError,
  isValidGrantApplicationStatus,
  transitionGrantApplicationStatus,
} from "@/backend/services/grantApplicationLifecycle";
import { generateAndStoreGrantDocument } from "@/backend/services/grantDocument";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestContext = getRequestAuditContext(request);
  const { id: projectId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "GRANT_APPLICATION_STATUS_CHANGE",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        projectId,
        resourceType: "grant_application_status",
        resourceId: projectId,
        description: "Unauthenticated grant application status transition attempt",
        ...requestContext,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "GRANT_APPLICATION_STATUS_CHANGE",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "grant_application_status",
        resourceId: projectId,
        description: "Grant status transition rejected due to invalid JSON body",
        ...requestContext,
      });
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const input = body as {
      toStatus?: unknown;
      reason?: unknown;
      metadata?: unknown;
    };

    if (!isValidGrantApplicationStatus(input.toStatus)) {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "GRANT_APPLICATION_STATUS_CHANGE",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "grant_application_status",
        resourceId: projectId,
        description: "Grant status transition rejected due to invalid toStatus",
        metadata: {
          providedToStatus: input.toStatus,
        },
        ...requestContext,
      });
      return NextResponse.json({ error: "Invalid toStatus provided" }, { status: 400 });
    }

    if (typeof input.reason !== "undefined" && input.reason !== null && typeof input.reason !== "string") {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "GRANT_APPLICATION_STATUS_CHANGE",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "grant_application_status",
        resourceId: projectId,
        description: "Grant status transition rejected due to invalid reason type",
        metadata: {
          providedReasonType: typeof input.reason,
        },
        ...requestContext,
      });
      return NextResponse.json({ error: "reason must be a string" }, { status: 400 });
    }

    const transitionResult = await transitionGrantApplicationStatus({
      projectId,
      actorUserId: session.user.id,
      toStatus: input.toStatus,
      reason: (input.reason as string | undefined) ?? null,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    });

    let grantDocumentResult:
      | {
          success: true;
          grantDocumentKey: string;
          previousGrantDocumentKey: string | null;
        }
      | {
          success: false;
          error: string;
        }
      | null = null;

    if (transitionResult.toStatus === "APPROVED") {
      try {
        const generated = await generateAndStoreGrantDocument({
          projectId,
          actorUserId: session.user.id,
          ...requestContext,
        });

        grantDocumentResult = {
          success: true,
          grantDocumentKey: generated.grantDocumentKey,
          previousGrantDocumentKey: generated.previousGrantDocumentKey,
        };
      } catch (grantDocumentError) {
        grantDocumentResult = {
          success: false,
          error:
            grantDocumentError instanceof Error
              ? grantDocumentError.message
              : "Failed to generate grant document",
        };
      }
    }

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "GRANT_APPLICATION_STATUS_CHANGE",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "grant_application_status",
      resourceId: transitionResult.historyId,
      reason: (input.reason as string | undefined) ?? null,
      description: "Grant application lifecycle status updated",
      beforeState: {
        grantApplicationStatus: transitionResult.fromStatus,
      },
      afterState: {
        grantApplicationStatus: transitionResult.toStatus,
      },
      metadata: {
        historyId: transitionResult.historyId,
        changedAt: transitionResult.changedAt.toISOString(),
        grantDocumentGeneration: grantDocumentResult,
      },
      ...requestContext,
    });

    return NextResponse.json(
      {
        success: true,
        transition: transitionResult,
        grantDocumentGeneration: grantDocumentResult,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof GrantLifecycleTransitionError) {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "GRANT_APPLICATION_STATUS_CHANGE",
        outcome: error.statusCode === 403 ? "DENIED" : "FAILURE",
        sensitivityLevel: "RESTRICTED",
        projectId,
        resourceType: "grant_application_status",
        resourceId: projectId,
        description: error.message,
        ...requestContext,
      });
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }

    console.error("Grant application status transition error:", error);

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "GRANT_APPLICATION_STATUS_CHANGE",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      projectId,
      resourceType: "grant_application_status",
      resourceId: projectId,
      description: "Grant status transition failed due to internal error",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      ...requestContext,
    });

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
