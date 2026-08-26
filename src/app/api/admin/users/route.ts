/**
 * API Route: /api/admin/users
 * GET: list all users with their current role (admin management picker data).
 * Auth: NextAuth (admin only, and the actor must have MFA enrolled).
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError } from "@/backend/auth/requireRole";
import { MfaSetupRequiredError, requireAdminWithMfaEnrolled } from "@/backend/auth/requireAdminMfa";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { listUsersWithRoles } from "@/backend/services/userRole";

async function requireAdminForUserList(request: Request, session: Session | null): Promise<Response | null> {
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
        resourceType: "AdminUserList",
        reason: error.message,
        description: "Denied access to admin user list route",
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

export async function GET(request: Request) {
  try {
    const session = await auth();
    const denied = await requireAdminForUserList(request, session);
    if (denied) return denied;

    const users = await listUsersWithRoles();
    return Response.json({ users }, { status: 200 });
  } catch (error) {
    console.error("Admin user list GET error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
