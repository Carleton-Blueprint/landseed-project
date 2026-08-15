/**
 * API Route: /api/admin/projects/[projectId]/manual-mode
 * GET: Fetch the project's manual mode submission (modification type/scope/pricing)
 * PUT: Create or update the manual mode submission
 * Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import {
  ManualModeError,
  getManualModeSubmission,
  upsertManualModeSubmission,
} from "@/backend/services/manualMode";

async function requireAdminForManualMode(
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
        resourceType: "ManualModeSubmission",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to manual mode route",
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

function manualModeErrorResponse(error: unknown): Response | null {
  if (error instanceof ManualModeError) {
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
    const denied = await requireAdminForManualMode(request, session, projectId);
    if (denied) return denied;

    const submission = await getManualModeSubmission(projectId);
    return Response.json({ submission }, { status: 200 });
  } catch (error) {
    const known = manualModeErrorResponse(error);
    if (known) return known;

    console.error("Manual mode GET error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    const denied = await requireAdminForManualMode(request, session, projectId);
    if (denied) return denied;

    const body = await request.json();
    const auditContext = getRequestAuditContext(request);

    const submission = await upsertManualModeSubmission({
      projectId,
      actorUserId: session!.user!.id,
      modificationType: body?.modificationType,
      scope: body?.scope,
      pricingItems: body?.pricingItems,
      notes: body?.notes,
      markReady: body?.markReady === true,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json({ submission }, { status: 200 });
  } catch (error) {
    const known = manualModeErrorResponse(error);
    if (known) return known;

    console.error("Manual mode PUT error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
