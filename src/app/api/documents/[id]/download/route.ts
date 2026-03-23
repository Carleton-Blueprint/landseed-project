import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { getSignedDownloadUrl } from "lib/s3";
import { getRequestAuditContext, logAuditEventNonBlocking } from "@/backend/audit/log";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestContext = getRequestAuditContext(request);

  try {
    const { id } = await params;
    const session = await auth();
    if (!session?.user?.id) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "PROJECT_DOCUMENT_DOWNLOAD",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        projectId: id,
        resourceType: "project_document",
        resourceId: id,
        description: "Unauthenticated document download attempt",
        ...requestContext,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, grantDocumentKey: true },
    });

    if (!project) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "PROJECT_DOCUMENT_DOWNLOAD",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId: id,
        resourceType: "project_document",
        resourceId: id,
        description: "Document download attempted for non-existent project",
        ...requestContext,
      });
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const canViewProject = await hasProjectAccess(session.user.id, project.id);
    if (!canViewProject) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "PROJECT_DOCUMENT_DOWNLOAD",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId: project.id,
        resourceType: "project_document",
        resourceId: project.id,
        description: "Document download denied due to missing project access",
        ...requestContext,
      });
      return NextResponse.json({ error: "Unauthorized access to project" }, { status: 403 });
    }

    if (!project.grantDocumentKey) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "PROJECT_DOCUMENT_DOWNLOAD",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId: project.id,
        resourceType: "project_document",
        resourceId: project.id,
        description: "Document download requested but no document exists",
        ...requestContext,
      });
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const signedUrl = await getSignedDownloadUrl(project.grantDocumentKey, 3600); // 1 hour link

    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "PROJECT_DOCUMENT_DOWNLOAD",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId: project.id,
      resourceType: "project_document",
      resourceId: project.id,
      description: "Signed project document download URL generated",
      metadata: {
        expiresInSeconds: 3600,
      },
      ...requestContext,
    });

    return NextResponse.redirect(signedUrl);
  } catch (error) {
    console.error("Error generating signed url:", error);

    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "PROJECT_DOCUMENT_DOWNLOAD",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      resourceType: "project_document",
      description: "Document download failed due to internal error",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      ...requestContext,
    });

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
