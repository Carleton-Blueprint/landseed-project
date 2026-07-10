/**
 * API Route: /api/admin/projects/[projectId]/modification-override
 * PUT: Override intake modification type/scope before the delayed preliminary
 * estimate is generated (FR-4.10).
 * Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import {
  ModificationOverrideError,
  overridePreEstimateModifications,
} from "@/backend/services/modificationOverride";

async function requireAdminForModificationOverride(
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
        resourceType: "ProjectModificationOverride",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to pre-estimate modification override route",
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

function modificationOverrideErrorResponse(error: unknown): Response | null {
  if (error instanceof ModificationOverrideError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...(error.redirectTo ? { redirectTo: error.redirectTo } : {}),
      },
      { status: error.statusCode }
    );
  }

  return null;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    const denied = await requireAdminForModificationOverride(request, session, projectId);
    if (denied) return denied;

    const body = await request.json();
    const auditContext = getRequestAuditContext(request);

    const result = await overridePreEstimateModifications({
      projectId,
      actorUserId: session!.user!.id,
      modificationItems: body?.modificationItems,
      reason: body?.reason,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    const known = modificationOverrideErrorResponse(error);
    if (known) return known;

    console.error("Modification override PUT error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
