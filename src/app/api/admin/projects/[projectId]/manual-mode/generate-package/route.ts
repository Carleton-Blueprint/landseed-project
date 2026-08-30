/**
 * API Route: /api/admin/projects/[projectId]/manual-mode/generate-package
 * POST: Generate the complete output package (quote, grant document,
 * downloadable BuilderTrend export package) from a project's manual mode
 * submission.
 * Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { ManualModeError, generateManualOutputPackage } from "@/backend/services/manualMode";

async function requireAdminForManualModePackage(
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
        resourceType: "ManualModeOutputPackage",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to manual mode output package generation route",
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    const denied = await requireAdminForManualModePackage(request, session, projectId);
    if (denied) return denied;

    const auditContext = getRequestAuditContext(request);

    const result = await generateManualOutputPackage({
      projectId,
      actorUserId: session!.user!.id,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    const known = manualModeErrorResponse(error);
    if (known) return known;

    console.error("Manual mode output package generation error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
