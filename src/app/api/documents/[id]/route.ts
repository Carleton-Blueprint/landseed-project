/**
 * API route: DELETE /api/documents/[id] — deletes a supporting document.
 * Requires authentication and EDITOR-level project access.
 */
import { NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { ProjectAccessRole } from "@prisma/client";
import { getRequestAuditContext, logAuditEventNonBlocking } from "@/backend/audit/log";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestContext = getRequestAuditContext(request);

  try {
    const { id } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Find the document
    const document = await prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        fileName: true,
        documentType: true,
        s3Key: true,
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Check project access
    const canDelete = await hasProjectAccess(
      session.user.id,
      document.projectId,
      ProjectAccessRole.EDITOR
    );
    if (!canDelete) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "DOCUMENT_DELETE",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId: document.projectId,
        resourceType: "document",
        resourceId: id,
        description: "Document deletion denied due to missing project access",
        ...requestContext,
      });
      return NextResponse.json(
        { error: "Unauthorized access to project" },
        { status: 403 }
      );
    }

    // Delete from database (S3 cleanup can be handled by a background job)
    await prisma.document.delete({ where: { id } });

    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "DOCUMENT_DELETE",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId: document.projectId,
      resourceType: "document",
      resourceId: id,
      description: `Supporting document deleted: ${document.fileName}`,
      metadata: {
        fileName: document.fileName,
        documentType: document.documentType,
        s3Key: document.s3Key,
      },
      ...requestContext,
    });

    return NextResponse.json({ success: true, message: "Document deleted" });
  } catch (error) {
    console.error("Error deleting document:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
