import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { getRequestAuditContext, logAuditEventNonBlocking } from "@/backend/audit/log";
import { getSignedDownloadUrl } from "lib/s3";

const DEFAULT_DOWNLOAD_EXPIRY_SECONDS = 3600;
const MIN_DOWNLOAD_EXPIRY_SECONDS = 60;
const MAX_DOWNLOAD_EXPIRY_SECONDS = 86400;

function getDownloadExpirySeconds(): number {
  const raw = process.env.MANUAL_FALLBACK_EXPORT_DOWNLOAD_URL_EXPIRY_SECONDS;
  if (!raw) {
    return DEFAULT_DOWNLOAD_EXPIRY_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_DOWNLOAD_EXPIRY_SECONDS;
  }

  return Math.min(MAX_DOWNLOAD_EXPIRY_SECONDS, Math.max(MIN_DOWNLOAD_EXPIRY_SECONDS, parsed));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; exportRequestId: string }> }
) {
  const requestContext = getRequestAuditContext(request);
  const { id: projectId, exportRequestId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "MANUAL_FALLBACK_EXPORT_DOWNLOAD",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        projectId,
        resourceType: "manual_fallback_export",
        resourceId: exportRequestId,
        description: "Unauthenticated fallback export download attempt",
        ...requestContext,
      });

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const exportRecord = await prisma.manualFallbackExport.findUnique({
      where: { id: exportRequestId },
      select: {
        id: true,
        projectId: true,
        status: true,
        s3Key: true,
        fileName: true,
        expiresAt: true,
      },
    });

    if (!exportRecord || exportRecord.projectId !== projectId) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "MANUAL_FALLBACK_EXPORT_DOWNLOAD",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "manual_fallback_export",
        resourceId: exportRequestId,
        description: "Fallback export download requested for missing export record",
        ...requestContext,
      });

      return NextResponse.json({ error: "Export not found" }, { status: 404 });
    }

    const canViewProject = await hasProjectAccess(session.user.id, projectId);
    if (!canViewProject) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "MANUAL_FALLBACK_EXPORT_DOWNLOAD",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "manual_fallback_export",
        resourceId: exportRecord.id,
        description: "Fallback export download denied due to missing project access",
        ...requestContext,
      });

      return NextResponse.json({ error: "Unauthorized access to project" }, { status: 403 });
    }

    if (exportRecord.status !== "READY" || !exportRecord.s3Key) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "MANUAL_FALLBACK_EXPORT_DOWNLOAD",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "manual_fallback_export",
        resourceId: exportRecord.id,
        description: "Fallback export download requested before archive was ready",
        metadata: {
          status: exportRecord.status,
        },
        ...requestContext,
      });

      return NextResponse.json({ error: "Export is not ready yet" }, { status: 409 });
    }

    if (exportRecord.expiresAt && exportRecord.expiresAt.getTime() <= Date.now()) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "MANUAL_FALLBACK_EXPORT_DOWNLOAD",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "manual_fallback_export",
        resourceId: exportRecord.id,
        description: "Fallback export download requested after expiration",
        metadata: {
          expiresAt: exportRecord.expiresAt.toISOString(),
        },
        ...requestContext,
      });

      return NextResponse.json({ error: "Export has expired" }, { status: 410 });
    }

    const expiresInSeconds = getDownloadExpirySeconds();
    const signedUrl = await getSignedDownloadUrl(exportRecord.s3Key, expiresInSeconds);

    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "MANUAL_FALLBACK_EXPORT_DOWNLOAD",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "manual_fallback_export",
      resourceId: exportRecord.id,
      description: "Signed fallback export download URL generated",
      metadata: {
        expiresInSeconds,
        fileName: exportRecord.fileName,
      },
      ...requestContext,
    });

    return NextResponse.redirect(signedUrl);
  } catch (error) {
    console.error("Manual fallback export download error:", error);

    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "MANUAL_FALLBACK_EXPORT_DOWNLOAD",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      projectId,
      resourceType: "manual_fallback_export",
      resourceId: exportRequestId,
      description: "Fallback export download failed due to internal error",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      ...requestContext,
    });

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}