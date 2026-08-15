/**
 * API route: PATCH /api/admin/projects/[projectId]/documents/[documentId]/visibility
 * Toggles the `isClientVisible` field of a document.
 */
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { requireMinimumRole } from "@/backend/auth/requireRole";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; documentId: string }> }
) {
  try {
    const { projectId, documentId } = await params;
    const session = await auth();
    await requireMinimumRole(session, "ADMIN"); // Admin

    const body = await request.json();
    if (typeof body.isClientVisible !== "boolean") {
      return NextResponse.json({ error: "Invalid isClientVisible value" }, { status: 400 });
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId, projectId },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: { isClientVisible: body.isClientVisible },
      select: { id: true, isClientVisible: true },
    });

    return NextResponse.json({ document: updatedDocument });
  } catch (error) {
    console.error("Error updating document visibility:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
