/**
 * API route: GET /api/project/[id]/grant-signature-status
 * Returns which required grant acknowledgements have been signed.
 */
import { NextRequest, NextResponse } from "next/server";
import { ProjectAccessRole } from "@prisma/client";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { getGrantSignatureStatusForProject } from "@/backend/services/grantSignatures";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hasAccess = await hasProjectAccess(session.user.id, projectId, ProjectAccessRole.VIEWER);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const status = await getGrantSignatureStatusForProject(projectId);
    return NextResponse.json(status);
  } catch (error) {
    console.error("Grant signature status GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
