/**
 * API Route: /api/admin/projects/[projectId]/manual-mode/documents
 * POST: Attach a custom drawing or vendor quote to a project's manual mode
 * submission (multipart/form-data).
 * Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { ManualModeError, attachManualModeDocument } from "@/backend/services/manualMode";

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
];
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx"];

async function requireAdminForManualModeDocuments(
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
        resourceType: "ManualModeDocument",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to manual mode document upload route",
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
    const denied = await requireAdminForManualModeDocuments(request, session, projectId);
    if (denied) return denied;

    const formData = await request.formData();
    const file = formData.get("file");
    const documentType = formData.get("documentType");
    const label = formData.get("label");

    if (!file || !(file instanceof File)) {
      return Response.json({ error: "Missing or invalid file in form field 'file'" }, { status: 400 });
    }

    if (typeof documentType !== "string") {
      return Response.json({ error: "Missing documentType" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: "File too large. Maximum size is 15MB." }, { status: 400 });
    }

    const fileExtension = "." + (file.name.split(".").pop()?.toLowerCase() || "");
    if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return Response.json(
        { error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP, DOCX." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const auditContext = getRequestAuditContext(request);

    const document = await attachManualModeDocument({
      projectId,
      actorUserId: session!.user!.id,
      documentType,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      buffer,
      label: typeof label === "string" ? label : null,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return Response.json({ document }, { status: 201 });
  } catch (error) {
    const known = manualModeErrorResponse(error);
    if (known) return known;

    console.error("Manual mode document upload error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
