/**
 * API Route: /api/admin/mfa/enroll
 * POST: Generate a new TOTP secret + QR code for the current admin session
 *       user. mfaEnabled stays false until /api/admin/mfa/verify confirms
 *       the first code.
 * Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { MfaEnrollmentError, startMfaEnrollment } from "@/backend/services/mfaEnrollment";

async function requireAdminForMfaEnroll(
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
        description: "Denied access to MFA enrollment route",
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
    const denied = await requireAdminForMfaEnroll(request, session);
    if (denied) return denied;

    const material = await startMfaEnrollment(session!.user!.id);
    return Response.json(material, { status: 200 });
  } catch (error) {
    if (error instanceof MfaEnrollmentError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }

    console.error("MFA enrollment start error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
