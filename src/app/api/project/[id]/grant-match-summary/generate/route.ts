import { NextRequest, NextResponse } from "next/server";
import { ProjectAccessRole } from "@prisma/client";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { generateAndStoreGrantMatchSummaryDocument } from "@/backend/services/grantMatchSummaryDocument";

// Manual "Regenerate PDF" action for the Grant Match Summary, mirroring
// grant-document/regenerate. Bypasses the skip-if-unchanged check so
// staff/owners can force a fresh version after correcting project data
// or re-running eligibility assessment out of band.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasAccess = await hasProjectAccess(session.user.id, projectId, ProjectAccessRole.EDITOR);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await generateAndStoreGrantMatchSummaryDocument({
      projectId,
      actorUserId: session.user.id,
      force: true,
    });

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "No eligibility assessment found for project") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    console.error("Grant match summary regeneration error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
