import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { getSignedDownloadUrl } from "lib/s3";

const DEFAULT_DOWNLOAD_EXPIRY_SECONDS = 3600;
const MIN_DOWNLOAD_EXPIRY_SECONDS = 60;
const MAX_DOWNLOAD_EXPIRY_SECONDS = 86400;

function getDownloadExpirySeconds(): number {
  const raw = process.env.GRANT_MATCH_SUMMARY_DOWNLOAD_URL_EXPIRY_SECONDS;
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
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const requestContext = getRequestAuditContext(request);
  const { id: projectId, docId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "GRANT_MATCH_SUMMARY_DOWNLOAD",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        projectId,
        resourceType: "grant_match_summary_document",
        resourceId: docId,
        description: "Unauthenticated grant match summary download attempt",
        ...requestContext,
      });

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const document = await prisma.grantMatchSummaryDocument.findUnique({
      where: { id: docId },
      select: { id: true, projectId: true, status: true, s3Key: true, fileName: true },
    });

    if (!document || document.projectId !== projectId) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "GRANT_MATCH_SUMMARY_DOWNLOAD",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "grant_match_summary_document",
        resourceId: docId,
        description: "Grant match summary download requested for missing document",
        ...requestContext,
      });

      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const canViewProject = await hasProjectAccess(session.user.id, projectId);
    if (!canViewProject) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "GRANT_MATCH_SUMMARY_DOWNLOAD",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "grant_match_summary_document",
        resourceId: document.id,
        description: "Grant match summary download denied due to missing project access",
        ...requestContext,
      });

      return NextResponse.json({ error: "Unauthorized access to project" }, { status: 403 });
    }

    if (document.status !== "READY" || !document.s3Key) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "GRANT_MATCH_SUMMARY_DOWNLOAD",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "grant_match_summary_document",
        resourceId: document.id,
        description: "Grant match summary download requested before document was ready",
        metadata: { status: document.status },
        ...requestContext,
      });

      return NextResponse.json({ error: "Document is not ready yet" }, { status: 409 });
    }

    const expiresInSeconds = getDownloadExpirySeconds();
    const signedUrl = await getSignedDownloadUrl(document.s3Key, expiresInSeconds);

    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "GRANT_MATCH_SUMMARY_DOWNLOAD",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "grant_match_summary_document",
      resourceId: document.id,
      description: "Signed grant match summary download URL generated",
      metadata: { expiresInSeconds, fileName: document.fileName },
      ...requestContext,
    });

    return NextResponse.redirect(signedUrl);
  } catch (error) {
    console.error("Grant match summary download error:", error);

    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "GRANT_MATCH_SUMMARY_DOWNLOAD",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      projectId,
      resourceType: "grant_match_summary_document",
      resourceId: docId,
      description: "Grant match summary download failed due to internal error",
      metadata: { errorMessage: error instanceof Error ? error.message : "Unknown error" },
      ...requestContext,
    });

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
