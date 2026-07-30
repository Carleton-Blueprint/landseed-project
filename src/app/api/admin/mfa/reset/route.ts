/**
 * API Route: /api/admin/mfa/reset
 * GET: list advisory-team admins and their MFA enrollment status (picker data).
 * POST: reset another admin's MFA enrollment (lost/broken/stolen device recovery).
 * Auth: NextAuth (admin/advisory only, and the actor must have MFA enrolled).
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError } from "@/backend/auth/requireRole";
import { MfaSetupRequiredError, requireAdminWithMfaEnrolled } from "@/backend/auth/requireAdminMfa";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { MfaResetError, listAdminsWithMfaStatus, resetAdminMfa } from "@/backend/services/mfaReset";

async function requireAdminForMfaReset(request: Request, session: Session | null): Promise<Response | null> {
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
        resourceType: "AdminMfaReset",
        reason: error.message,
        description: "Denied access to admin MFA reset route",
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

function mfaResetErrorResponse(error: unknown): Response | null {
  if (error instanceof MfaResetError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    const denied = await requireAdminForMfaReset(request, session);
    if (denied) return denied;

    const admins = await listAdminsWithMfaStatus();
    return Response.json({ admins }, { status: 200 });
  } catch (error) {
    console.error("Admin MFA reset GET error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    const denied = await requireAdminForMfaReset(request, session);
    if (denied) return denied;

    const body = await request.json();
    const auditContext = getRequestAuditContext(request);

    const result = await resetAdminMfa({
      targetUserId: body?.targetUserId,
      actorUserId: session!.user!.id,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    const known = mfaResetErrorResponse(error);
    if (known) return known;

    console.error("Admin MFA reset POST error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
