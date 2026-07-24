/**
 * API route: GET /api/project/[id]/information-requests
 * Lets a client (or authorized caregiver) view staff requests for
 * additional photos, documents, or information on their project.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { ProjectAccessRole } from "@prisma/client";
import { listInformationRequestsForProject } from "@/backend/services/informationRequests";

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

    const informationRequests = await listInformationRequestsForProject(projectId);
    return NextResponse.json({ informationRequests });
  } catch (error) {
    console.error("[InformationRequestsAPI]", error);
    return NextResponse.json({ error: "Failed to fetch information requests" }, { status: 500 });
  }
}
