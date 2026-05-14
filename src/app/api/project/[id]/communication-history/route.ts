import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCommunicationHistoryForProject } from "@/backend/services/communicationHistoryLogger";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { ProjectAccessRole, CommunicationCategory, CommunicationType, CommunicationStatus } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authentication check
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Authorization check
    const hasAccess = await hasProjectAccess(
      session.user.id,
      params.id,
      ProjectAccessRole.VIEWER
    );

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");
    const category = searchParams.get("category") as CommunicationCategory | null;
    const recipientId = searchParams.get("recipientId") || undefined;
    const communicationType = searchParams.get("communicationType") as CommunicationType | null;
    const status = searchParams.get("status") as CommunicationStatus | null;
    const since = searchParams.get("since") ? new Date(searchParams.get("since")!) : undefined;

    // Fetch communication history
    const result = await getCommunicationHistoryForProject(params.id, {
      limit,
      offset,
      ...(category && { category }),
      recipientId,
      ...(communicationType && { communicationType }),
      ...(status && { status }),
      since,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[CommunicationHistoryAPI]", error);
    return NextResponse.json(
      {
        error: "Failed to fetch communication history",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
