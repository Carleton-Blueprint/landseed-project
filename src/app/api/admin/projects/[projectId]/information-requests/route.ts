/**
 * API Route: /api/admin/projects/[projectId]/information-requests
 * GET: List information requests staff have made on a project (any status).
 * POST: Request additional photos, documents, or information from a client.
 * Auth: NextAuth (admin/advisory only)
 */

import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  INFORMATION_REQUEST_AUDIT_ACTIONS,
  InformationRequestError,
  createInformationRequest,
  listInformationRequestsForProject,
} from "@/backend/services/informationRequests";
import { enqueueInformationRequestNotificationForClient } from "@/backend/notifications/informationRequestNotificationContract";

async function requireAdminForInformationRequests(
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
        resourceType: "InformationRequest",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to staff information request route",
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

function informationRequestErrorResponse(error: unknown): Response | null {
  if (error instanceof InformationRequestError) {
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
    const denied = await requireAdminForInformationRequests(request, session, projectId);
    if (denied) return denied;

    const informationRequests = await listInformationRequestsForProject(projectId);
    return Response.json({ informationRequests }, { status: 200 });
  } catch (error) {
    const known = informationRequestErrorResponse(error);
    if (known) return known;

    console.error("Information request GET error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    const denied = await requireAdminForInformationRequests(request, session, projectId);
    if (denied) return denied;

    const body = await request.json();
    const { informationRequest, project } = await createInformationRequest({
      projectId,
      requestedByUserId: session!.user!.id,
      requestType: body?.requestType,
      message: body?.message,
    });

    if (project.user.email) {
      try {
        await enqueueInformationRequestNotificationForClient({
          informationRequestId: informationRequest.id,
          projectId: project.id,
          projectAddress: project.address,
          requestType: informationRequest.requestType,
          message: informationRequest.message,
          requestedByUserId: informationRequest.requestedByUserId,
          clientUserId: project.userId,
          clientEmail: project.user.email,
          clientName: project.user.name,
        });
      } catch (notificationError) {
        console.error("Failed to enqueue information request notification:", notificationError);

        await logAuditEventNonBlocking({
          category: "MANUAL_CHANGE",
          action: INFORMATION_REQUEST_AUDIT_ACTIONS.NOTIFICATION_FAILED,
          outcome: "FAILURE",
          sensitivityLevel: "CONFIDENTIAL",
          actorUserId: session!.user!.id,
          projectId: project.id,
          resourceType: "InformationRequest",
          resourceId: informationRequest.id,
          description: "Failed to enqueue client notification for information request",
          metadata: {
            errorMessage:
              notificationError instanceof Error ? notificationError.message : "Unknown error",
          },
        });
      }
    } else {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: INFORMATION_REQUEST_AUDIT_ACTIONS.NOTIFICATION_FAILED,
        outcome: "FAILURE",
        sensitivityLevel: "CONFIDENTIAL",
        actorUserId: session!.user!.id,
        projectId: project.id,
        resourceType: "InformationRequest",
        resourceId: informationRequest.id,
        description: "Client has no email on file; notification not sent",
      });
    }

    return Response.json({ informationRequest }, { status: 201 });
  } catch (error) {
    const known = informationRequestErrorResponse(error);
    if (known) return known;

    console.error("Information request POST error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
