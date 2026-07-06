/**
 * API Route: /api/admin/projects/[projectId]/notes
 * GET: List staff notes for a project
 * POST: Create a staff note on a project
 * Auth: NextAuth (admin/advisory only)
 */

import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import {
  ProjectStaffNoteError,
  createNote,
  listNotesForProject,
} from "@/backend/services/projectStaffNotes";

async function requireAdminForStaffNotes(
  request: Request,
  session: Awaited<ReturnType<typeof auth>>,
  projectId: string
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
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to project staff notes route",
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    const denied = await requireAdminForStaffNotes(request, session, projectId);
    if (denied) return denied;

    const notes = await listNotesForProject(projectId);
    return Response.json({ notes }, { status: 200 });
  } catch (error) {
    const known = staffNoteErrorResponse(error);
    if (known) return known;

    console.error("Project staff notes GET error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    const denied = await requireAdminForStaffNotes(request, session, projectId);
    if (denied) return denied;

    const body = await request.json();
    const note = await createNote({
      projectId,
      authorUserId: session!.user!.id,
      content: body?.content,
    });

    return Response.json(note, { status: 201 });
  } catch (error) {
    const known = staffNoteErrorResponse(error);
    if (known) return known;

    console.error("Project staff notes POST error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
