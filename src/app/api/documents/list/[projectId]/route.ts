/**
 * API route: GET /api/documents/list/[projectId] — lists all documents for a project.
 * Requires authentication and project access.
 */
import { NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const canView = await hasProjectAccess(session.user.id, projectId);
    if (!canView) {
      return NextResponse.json(
        { error: "Unauthorized access to project" },
        { status: 403 }
      );
    }

    const documents = await prisma.document.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        documentType: true,
        label: true,
        virusScanStatus: true,
        reviewStatus: true,
        reviewNote: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Error listing documents:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
