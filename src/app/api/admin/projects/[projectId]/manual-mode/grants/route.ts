/**
 * API Route: /api/admin/projects/[projectId]/manual-mode/grants
 * POST: Save staff-entered grant matches as a real EligibilityAssessment
 * snapshot, bypassing AI-driven grant discovery entirely.
 * Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { ManualModeError, saveManualGrantMatches } from "@/backend/services/manualMode";

async function requireAdminForManualModeGrants(
  request: Request,
  session: Session | null,
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
        resourceType: "ManualModeGrants",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to manual mode grants route",
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    const denied = await requireAdminForManualModeGrants(request, session, projectId);
    if (denied) return denied;

    const body = await request.json();
    const auditContext = getRequestAuditContext(request);

    const result = await saveManualGrantMatches({
      projectId,
      actorUserId: session!.user!.id,
      grants: body?.grants,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ManualModeError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }

    console.error("Manual mode grants POST error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
