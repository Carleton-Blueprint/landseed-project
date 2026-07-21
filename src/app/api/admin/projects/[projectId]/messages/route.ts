/**
 * API Route: /api/admin/projects/[projectId]/messages
 * POST: Compose and send a custom email to a project client (admin/advisory only)
 * Auth: NextAuth (admin/advisory only)
 */

import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { AdminCustomEmailError, sendAdminCustomEmail } from "@/backend/services/adminCustomEmail";

async function requireAdminForCustomEmail(
  request: Request,
  session: Awaited<ReturnType<typeof auth>>,
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
        resourceType: "CommunicationHistory",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to admin custom email route",
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

function customEmailErrorResponse(error: unknown): Response | null {
  if (error instanceof AdminCustomEmailError) {
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
    const denied = await requireAdminForCustomEmail(request, session, projectId);
    if (denied) return denied;

    const body = await request.json();
    const result = await sendAdminCustomEmail({
      projectId,
      recipientId: body?.recipientId,
      subject: body?.subject,
      message: body?.message,
      senderId: session!.user!.id,
    });

    if (!result.delivered) {
      return Response.json(
        {
          success: false,
          communicationId: result.communicationId,
          error: result.deliveryError ?? "Failed to send email",
        },
        { status: 502 }
      );
    }

    return Response.json(
      {
        success: true,
        communicationId: result.communicationId,
        provider: result.provider,
        messageId: result.messageId,
      },
      { status: 200 }
    );
  } catch (error) {
    const known = customEmailErrorResponse(error);
    if (known) return known;

    console.error("Admin custom email POST error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
