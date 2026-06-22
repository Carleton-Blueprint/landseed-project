/**
 * DELETE /api/photos/[id] – Remove a photo from a draft intake project.
 */
import { NextRequest, NextResponse } from "next/server";
import { ProjectAccessRole } from "@prisma/client";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { prisma } from "lib/prisma";
import { deleteObjectFromS3 } from "lib/s3";
import { isPrivateS3PhotoUrl } from "lib/photoUrls";

async function deletePhotoObjectFromStorage(url: string) {
  if (!isPrivateS3PhotoUrl(url)) return;

  const parsed = new URL(url);
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!key) return;

  await deleteObjectFromS3(key);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    const photo = await prisma.photo.findUnique({
      where: { id },
      select: {
        id: true,
        url: true,
        projectId: true,
        project: {
          select: { status: true },
        },
      },
    });

    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    if (photo.project.status !== "draft") {
      return NextResponse.json(
        { error: "Photos can only be removed from draft projects" },
        { status: 403 }
      );
    }

    const canDelete = await hasProjectAccess(
      session.user.id,
      photo.projectId,
      ProjectAccessRole.EDITOR
    );
    if (!canDelete) {
      return NextResponse.json({ error: "Unauthorized access to project" }, { status: 403 });
    }

    try {
      await deletePhotoObjectFromStorage(photo.url);
    } catch (err) {
      console.error(`Failed to delete S3 object for photo ${photo.id}:`, err);
    }

    await prisma.photo.delete({ where: { id: photo.id } });

    return NextResponse.json({ success: true, photoId: photo.id });
  } catch (err) {
    console.error("Photo delete error:", err);
    return NextResponse.json({ error: "Failed to delete photo" }, { status: 500 });
  }
}
