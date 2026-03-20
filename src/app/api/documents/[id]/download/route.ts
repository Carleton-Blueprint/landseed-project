import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { getSignedDownloadUrl } from "lib/s3";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, grantDocumentKey: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const canViewProject = await hasProjectAccess(session.user.id, project.id);
    if (!canViewProject) {
      return NextResponse.json({ error: "Unauthorized access to project" }, { status: 403 });
    }

    if (!project.grantDocumentKey) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const signedUrl = await getSignedDownloadUrl(project.grantDocumentKey, 3600); // 1 hour link

    return NextResponse.redirect(signedUrl);
  } catch (error) {
    console.error("Error generating signed url:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
