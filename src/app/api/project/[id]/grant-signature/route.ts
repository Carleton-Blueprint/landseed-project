/**
 * API route: POST /api/project/[id]/grant-signature
 * Submits a signature/acknowledgement for a project's grant application.
 * Available to the client (project OWNER) and any authorized caregiver
 * (project EDITOR+) — see hasProjectAccess. Records are immutable: this
 * route only ever creates rows, never updates or deletes them.
 */
import { NextRequest, NextResponse } from "next/server";
import { ProjectAccessRole } from "@prisma/client";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { requireVerifiedEmail } from "@/backend/auth/requireVerifiedEmail";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { GrantSignatureError, createGrantSignature } from "@/backend/services/grantSignatures";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const requestContext = getRequestAuditContext(request);

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await requireVerifiedEmail(session);
    } catch (error) {
      const gateResponse = authGateResponse(error);
      if (gateResponse) return gateResponse;
      throw error;
    }

    const hasAccess = await hasProjectAccess(session.user.id, projectId, ProjectAccessRole.EDITOR);
    if (!hasAccess) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "GRANT_SIGNATURE_CREATE",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "GrantSignature",
        description: "Grant signature submission denied due to missing project access",
        ...requestContext,
      });
      return NextResponse.json({ error: "Unauthorized access to project" }, { status: 403 });
    }

    const body = await request.json();
    const signature = await createGrantSignature({
      projectId,
      signerUserId: session.user.id,
      acknowledgementType: body?.acknowledgementType,
      signatureData: body?.signatureData,
      ...requestContext,
    });

    return NextResponse.json({ signature }, { status: 201 });
  } catch (error) {
    if (error instanceof GrantSignatureError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }

    console.error("Grant signature POST error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
