/**
 * API Route: /api/admin/users/[userId]/role
 * PATCH: promote/demote a user's role (USER <-> ADMIN).
 * Auth: NextAuth (admin only, and the actor must have MFA enrolled).
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError } from "@/backend/auth/requireRole";
import { MfaSetupRequiredError, requireAdminWithMfaEnrolled } from "@/backend/auth/requireAdminMfa";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { UserRoleError, updateUserRole } from "@/backend/services/userRole";

async function requireAdminForUserRoleChange(
  request: Request,
  session: Session | null,
  targetUserId: string
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
        resourceType: "AdminUserRole",
        resourceId: targetUserId,
        reason: error.message,
        description: "Denied access to admin user role change route",
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

function userRoleErrorResponse(error: unknown): Response | null {
  if (error instanceof UserRoleError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }

  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await params;
    const session = await auth();
    const denied = await requireAdminForUserRoleChange(request, session, userId);
    if (denied) return denied;

    const body = await request.json();
    if (body?.role !== "ADMIN" && body?.role !== "USER") {
      return Response.json({ error: "role must be 'ADMIN' or 'USER'" }, { status: 400 });
    }

    const auditContext = getRequestAuditContext(request);

    const result = await updateUserRole({
      targetUserId: userId,
      newRole: body.role,
      actorUserId: session!.user!.id,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    const known = userRoleErrorResponse(error);
    if (known) return known;

    console.error("Admin user role PATCH error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
