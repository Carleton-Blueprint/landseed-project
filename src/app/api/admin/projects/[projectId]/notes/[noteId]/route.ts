/**
 * API Route: /api/admin/projects/[projectId]/notes/[noteId]
 * PUT: Update a staff note
 * DELETE: Remove a staff note
 * Auth: NextAuth (admin/advisory only)
 */

import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import {
  ProjectStaffNoteError,
  deleteNote,
  updateNote,
} from "@/backend/services/projectStaffNotes";

async function requireAdminForStaffNotes(
  request: Request,
  session: Awaited<ReturnType<typeof auth>>,
  projectId: string,
  noteId: string
): Promise<Response | null> {
  try {
    await requireMinimumRole(session, "ADMIN");
    return null;
  } catch (error) {
    if (error instanceof HttpError) {
      const auditContext = getRequestAuditContext(request);
      await logDeniedAdminAccessAttempt({
        surface: "route",
        actorUserId: session?.user?.id ?? null,
        routePath: new URL(request.url).pathname,
        method: request.method,
        resourceType: "ProjectStaffNote",
        resourceId: noteId,
        projectId,
        reason: error.message,
        description: "Denied access to project staff note route",
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

function staffNoteErrorResponse(error: unknown): Response | null {
  if (error instanceof ProjectStaffNoteError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }

  return null;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string; noteId: string }> }
) {
  try {
    const { projectId, noteId } = await params;
    const session = await auth();
    const denied = await requireAdminForStaffNotes(request, session, projectId, noteId);
    if (denied) return denied;

    const body = await request.json();
    const note = await updateNote({
      noteId,
      projectId,
      actorUserId: session!.user!.id,
      content: body?.content,
    });

    return Response.json(note, { status: 200 });
  } catch (error) {
    const known = staffNoteErrorResponse(error);
    if (known) return known;

    console.error("Project staff note PUT error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string; noteId: string }> }
) {
  try {
    const { projectId, noteId } = await params;
    const session = await auth();
    const denied = await requireAdminForStaffNotes(request, session, projectId, noteId);
    if (denied) return denied;

    await deleteNote({
      noteId,
      projectId,
      actorUserId: session!.user!.id,
    });

    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    const known = staffNoteErrorResponse(error);
    if (known) return known;

    console.error("Project staff note DELETE error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
