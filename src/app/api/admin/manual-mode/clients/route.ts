/**
 * API Route: /api/admin/manual-mode/clients
 * GET: search registered clients by name/email, for the Manual Mode
 * project-creation client picker.
 * Auth: NextAuth (admin only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { searchClientUsers } from "@/backend/services/manualMode";

async function requireAdminForClientSearch(request: Request, session: Session | null): Promise<Response | null> {
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
        resourceType: "ManualModeClientSearch",
        reason: error.message,
        description: "Denied access to manual mode client search route",
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
    const denied = await requireAdminForClientSearch(request, session);
    if (denied) return denied;

    const q = new URL(request.url).searchParams.get("q") ?? "";
    const clients = await searchClientUsers(q);
    return Response.json({ clients }, { status: 200 });
  } catch (error) {
    console.error("Manual mode client search GET error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
