/**
 * API Route: /api/admin/projects/[projectId]/documents/[documentId]/visibility
 * PATCH: Toggle a document's client-visibility flag (admin)
 * Auth: NextAuth (admin, MFA-enrolled only)
 */

import type { Session } from "next-auth";
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError } from "@/backend/auth/requireRole";
import { MfaSetupRequiredError, requireAdminWithMfaEnrolled } from "@/backend/auth/requireAdminMfa";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";

async function requireAdminForDocumentVisibility(
  request: Request,
  session: Session | null,
  projectId: string,
  documentId: string
): Promise<Response | null> {
  try {
    await requireAdminWithMfaEnrolled(session);
    return null;
  } catch (error) {
    if (error instanceof HttpError || error instanceof MfaSetupRequiredError) {
      const auditContext = getRequestAuditContext(request);
      await logDeniedAdminAccessAttempt({
        surface: "route",
        actorUserId: session?.user?.id ?? null,
        routePath: new URL(request.url).pathname,
        method: request.method,
        resourceType: "Document",
        resourceId: documentId,
        projectId,
        reason: error.message,
        description: "Denied access to document visibility route",
        ...auditContext,
        metadata: {
          source: "route-handler",
          requiredRole: "ADMIN",
        },
      });

      return authGateResponse(error) ?? Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: "forbidden" }, { status: 403 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; documentId: string }> }
) {
  try {
    const { projectId, documentId } = await params;
    const session = await auth();
    const denied = await requireAdminForDocumentVisibility(request, session, projectId, documentId);
    if (denied) return denied;

    const body = await request.json();
    if (typeof body.isClientVisible !== "boolean") {
      return NextResponse.json({ error: "Invalid isClientVisible value" }, { status: 400 });
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId, projectId },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: { isClientVisible: body.isClientVisible },
      select: { id: true, isClientVisible: true },
    });

    return NextResponse.json({ document: updatedDocument });
  } catch (error) {
    console.error("Error updating document visibility:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
