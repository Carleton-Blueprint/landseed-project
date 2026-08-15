import { NextRequest, NextResponse } from "next/server";
import { ProjectAccessRole } from "@prisma/client";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { generateAndStoreGrantDocument } from "@/backend/services/grantDocument";

// Manual "Regenerate PDF" action (FR-3.2). Bypasses the
// skip-if-unchanged check in generateAndStoreGrantDocument so staff/owners
// can force a fresh version after correcting project data out of band.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const requestContext = getRequestAuditContext(request);

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasAccess = await hasProjectAccess(session.user.id, projectId, ProjectAccessRole.EDITOR);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await generateAndStoreGrantDocument({
      projectId,
      actorUserId: session.user.id,
      force: true,
      ...requestContext,
    });

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    console.error("Grant document regeneration error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
