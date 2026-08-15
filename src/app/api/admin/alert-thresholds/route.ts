/**
 * API Route: /api/admin/alert-thresholds
 * GET: list all monitoring alert thresholds (AI job, BuilderTrend transfer,
 *      email delivery, file scan failures).
 * PATCH: update one threshold's count/window/enabled flag.
 * Auth: NextAuth (admin/advisory only, and the actor must have MFA enrolled).
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError } from "@/backend/auth/requireRole";
import { MfaSetupRequiredError, requireAdminWithMfaEnrolled } from "@/backend/auth/requireAdminMfa";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import {
  AlertThresholdError,
  getAllAlertThresholds,
  updateAlertThreshold,
} from "@/backend/services/alertThresholds";

async function requireAdminForAlertThresholds(
  request: Request,
  session: Session | null
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
        resourceType: "AlertThresholdConfig",
        reason: error.message,
        description: "Denied access to admin alert-thresholds route",
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

function alertThresholdErrorResponse(error: unknown): Response | null {
  if (error instanceof AlertThresholdError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    const denied = await requireAdminForAlertThresholds(request, session);
    if (denied) return denied;

    const thresholds = await getAllAlertThresholds();
    return Response.json({ thresholds }, { status: 200 });
  } catch (error) {
    console.error("Admin alert-thresholds GET error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    const denied = await requireAdminForAlertThresholds(request, session);
    if (denied) return denied;

    const body = await request.json();

    if (typeof body?.key !== "string") {
      return Response.json({ error: "key is required" }, { status: 400 });
    }

    const updated = await updateAlertThreshold({
      key: body.key,
      thresholdCount: typeof body.thresholdCount === "number" ? body.thresholdCount : undefined,
      windowMinutes: typeof body.windowMinutes === "number" ? body.windowMinutes : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      actorUserId: session!.user!.id,
    });

    return Response.json({ threshold: updated }, { status: 200 });
  } catch (error) {
    const known = alertThresholdErrorResponse(error);
    if (known) return known;

    console.error("Admin alert-thresholds PATCH error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
