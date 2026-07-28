/**
 * API Route: /api/admin/mfa/verify
 * POST: Confirm a TOTP code against the current session user's pending
 *       enrollment. Activates MFA (mfaEnabled = true) on success.
 * Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { MfaEnrollmentError, confirmMfaEnrollment } from "@/backend/services/mfaEnrollment";

async function requireAdminForMfaVerify(
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
        resourceType: "user_mfa",
        resourceId: session?.user?.id ?? null,
        reason: error.message,
        description: "Denied access to MFA verification route",
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
    const denied = await requireAdminForMfaVerify(request, session);
    if (denied) return denied;

    const body = await request.json();
    if (typeof body?.token !== "string" || !body.token.trim()) {
      return Response.json({ error: "A verification token is required" }, { status: 400 });
    }

    const result = await confirmMfaEnrollment(session!.user!.id, body.token.trim());
    return Response.json({ enrolledAt: result.enrolledAt.toISOString() }, { status: 200 });
  } catch (error) {
    if (error instanceof MfaEnrollmentError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }

    console.error("MFA enrollment verify error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
