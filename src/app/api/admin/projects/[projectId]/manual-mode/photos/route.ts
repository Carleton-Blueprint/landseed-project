/**
 * API Route: /api/admin/projects/[projectId]/manual-mode/photos
 * POST: Attach a reference photo to a project's manual mode submission
 * (multipart/form-data). Admin-scoped upload — unlike POST /api/upload,
 * this doesn't require ProjectAccess on the acting admin.
 * Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { ManualModeError, attachManualModePhoto } from "@/backend/services/manualMode";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

async function requireAdminForManualModePhotos(
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
        resourceType: "ManualModePhoto",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to manual mode photo upload route",
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
    const denied = await requireAdminForManualModePhotos(request, session, projectId);
    if (denied) return denied;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return Response.json({ error: "Missing or invalid file in form field 'file'" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: "File too large. Maximum size is 10MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const auditContext = getRequestAuditContext(request);

    const photo = await attachManualModePhoto({
      projectId,
      actorUserId: session!.user!.id,
      fileName: file.name,
      mimeType: file.type,
      buffer,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json({ photo }, { status: 201 });
  } catch (error) {
    const known = manualModeErrorResponse(error);
    if (known) return known;

    console.error("Manual mode photo upload error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
