import { NextResponse } from "next/server";
import { verifyAuditChain } from "@/backend/audit/verify";
import { auth } from "@/auth";
import { requireMinimumRole, HttpError } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";

export async function GET(request: Request) {
  try {
    const session = await auth();
    try {
      // Require ADMIN to run the audit verify
      await requireMinimumRole(session, "ADMIN");
    } catch (err) {
      if (err instanceof HttpError) {
        const auditContext = getRequestAuditContext(request);
        await logDeniedAdminAccessAttempt({
          surface: "route",
          actorUserId: session?.user?.id ?? null,
          routePath: new URL(request.url).pathname,
          method: request.method,
          resourceType: "AdminRoute",
          resourceId: "/api/admin/audit/verify",
          reason: err.message,
          description: "Denied access to audit verification route",
          ...auditContext,
          metadata: {
            source: "route-handler",
            requiredRole: "ADMIN",
          },
        });

        return new NextResponse(JSON.stringify({ error: err.message }), { status: err.status });
      }
      return new NextResponse(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }

    const result = await verifyAuditChain();
    return NextResponse.json(result);
  } catch (err) {
    return new NextResponse(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
