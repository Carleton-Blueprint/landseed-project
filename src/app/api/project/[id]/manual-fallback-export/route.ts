import { NextRequest, NextResponse } from "next/server";
import { ProjectAccessRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { requestManualFallbackExport } from "@/backend/services/manualFallbackExport";

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
        action: "MANUAL_FALLBACK_EXPORT_REQUEST",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        projectId,
        resourceType: "manual_fallback_export",
        resourceId: projectId,
        description: "Unauthenticated manual fallback export request",
        ...requestContext,
      });

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!project) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "MANUAL_FALLBACK_EXPORT_REQUEST",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "manual_fallback_export",
        resourceId: projectId,
        description: "Manual fallback export request rejected because project does not exist",
        ...requestContext,
      });

      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const canRequestExport = await hasProjectAccess(
      session.user.id,
      projectId,
      ProjectAccessRole.OWNER
    );

    if (!canRequestExport) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "MANUAL_FALLBACK_EXPORT_REQUEST",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "manual_fallback_export",
        resourceId: projectId,
        description: "Manual fallback export request denied because actor is not project owner",
        ...requestContext,
      });

      return NextResponse.json({ error: "Only project owners can request a fallback export" }, { status: 403 });
    }

    const exportRequest = await requestManualFallbackExport({
      projectId,
      requestedByUserId: session.user.id,
      requestedByEmail: project.user.email,
      requestedByName: project.user.name,
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "MANUAL_FALLBACK_EXPORT_REQUESTED",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "manual_fallback_export",
      resourceId: exportRequest.exportRequestId,
      description: "Manual fallback export queued for processing",
      metadata: {
        retentionDays: exportRequest.retentionDays,
        maxSizeBytes: exportRequest.maxSizeBytes ?? null,
      },
      ...requestContext,
    });

    return NextResponse.json(
      {
        success: true,
        exportRequestId: exportRequest.exportRequestId,
        projectId,
        requestedAt: exportRequest.requestedAt,
        retentionDays: exportRequest.retentionDays,
        maxSizeBytes: exportRequest.maxSizeBytes ?? null,
        status: "queued",
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Manual fallback export request error:", error);

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "MANUAL_FALLBACK_EXPORT_REQUESTED",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      projectId,
      resourceType: "manual_fallback_export",
      resourceId: projectId,
      description: "Manual fallback export request failed",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown export request error",
      },
      ...requestContext,
    });

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}