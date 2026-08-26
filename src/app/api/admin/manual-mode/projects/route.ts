/**
 * API Route: /api/admin/manual-mode/projects
 * POST: create a brand-new project from scratch for an existing client,
 * entering Manual Mode immediately (decoupled from any client-initiated
 * intake).
 * Auth: NextAuth (admin only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { ManualModeError, createManualModeProject } from "@/backend/services/manualMode";

async function requireAdminForManualModeProjectCreate(
  request: Request,
  session: Session | null
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
        resourceType: "ManualModeProject",
        reason: error.message,
        description: "Denied access to manual mode project creation route",
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

export async function POST(request: Request) {
  try {
    const session = await auth();
    const denied = await requireAdminForManualModeProjectCreate(request, session);
    if (denied) return denied;

    const body = await request.json();
    const auditContext = getRequestAuditContext(request);

    const result = await createManualModeProject({
      clientUserId: body?.clientUserId,
      actorUserId: session!.user!.id,
      address: body?.address,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ManualModeError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }

    console.error("Manual mode project creation POST error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
