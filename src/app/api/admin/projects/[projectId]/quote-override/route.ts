/**
 * API Route: /api/admin/projects/[projectId]/quote-override
 * PUT: FR-4.3 post-estimate override — pricing, modification scope, and
 * grant eligibility together, once a quote already exists. See
 * src/backend/services/quoteOverride.ts.
 * Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError } from "@/backend/auth/requireRole";
import { MfaSetupRequiredError, requireAdminWithMfaEnrolled } from "@/backend/auth/requireAdminMfa";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { QuoteOverrideError, overridePostEstimateQuote } from "@/backend/services/quoteOverride";

async function requireAdminForQuoteOverride(
  request: Request,
  session: Session | null,
  projectId: string
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
        resourceType: "QuoteOverride",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to post-estimate quote override route",
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

function quoteOverrideErrorResponse(error: unknown): Response | null {
  if (error instanceof QuoteOverrideError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
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
    const denied = await requireAdminForQuoteOverride(request, session, projectId);
    if (denied) return denied;

    const body = await request.json();
    const auditContext = getRequestAuditContext(request);

    const result = await overridePostEstimateQuote({
      projectId,
      actorUserId: session!.user!.id,
      photoModifications: body?.photoModifications,
      pricing: body?.pricing,
      eligibilityDecision: body?.eligibilityDecision,
      grantChanges: body?.grantChanges,
      reason: body?.reason,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    const known = quoteOverrideErrorResponse(error);
    if (known) return known;

    console.error("Quote override PUT error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
