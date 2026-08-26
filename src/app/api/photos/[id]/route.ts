/**
 * /api/photos/[id]
 * DELETE – Remove a photo from a draft intake project.
 * PATCH – Update a photo's declared modification tags (draft projects only).
 */
import { NextRequest, NextResponse } from "next/server";
import { ProjectAccessRole, ProjectStatus } from "@prisma/client";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { prisma } from "lib/prisma";
import { deleteObjectFromS3 } from "lib/s3";
import { isPrivateS3PhotoUrl } from "lib/photoUrls";
import { parseDeclaredModificationCodes } from "@/backend/eligibility/modificationNormalization";

async function deletePhotoObjectFromStorage(url: string) {
  if (!isPrivateS3PhotoUrl(url)) return;

  const parsed = new URL(url);
  const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  // R2 uses path-style URLs (<endpoint>/<bucket>/<key>), unlike S3's virtual-hosted-style
  // bucket subdomains, so the bucket name is now the first path segment and must be
  // dropped to recover the actual object key.
  const key = path.split("/").slice(1).join("/");
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

    if (photo.project.status !== ProjectStatus.DRAFT) {
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const modificationItemsRaw = (body as { modificationItems?: unknown })?.modificationItems;
    if (
      !Array.isArray(modificationItemsRaw) ||
      !modificationItemsRaw.every((value): value is string => typeof value === "string")
    ) {
      return NextResponse.json(
        { error: "modificationItems must be an array of strings" },
        { status: 400 }
      );
    }

    const { codes: declaredModificationCodes, invalidCodes } =
      parseDeclaredModificationCodes(modificationItemsRaw);
    if (invalidCodes.length > 0) {
      return NextResponse.json(
        { error: `Unknown modification code(s): ${invalidCodes.join(", ")}` },
        { status: 400 }
      );
    }

    const photo = await prisma.photo.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        project: {
          select: { status: true },
        },
      },
    });

    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    if (photo.project.status !== ProjectStatus.DRAFT) {
      return NextResponse.json(
        { error: "Modification tags can only be edited on draft projects" },
        { status: 403 }
      );
    }

    const canEdit = await hasProjectAccess(
      session.user.id,
      photo.projectId,
      ProjectAccessRole.EDITOR
    );
    if (!canEdit) {
      return NextResponse.json({ error: "Unauthorized access to project" }, { status: 403 });
    }

    const updated = await prisma.photo.update({
      where: { id: photo.id },
      data: { declaredModificationCodes },
    });

    return NextResponse.json({
      success: true,
      photo: { id: updated.id, declaredModificationCodes: updated.declaredModificationCodes },
    });
  } catch (err) {
    console.error("Photo tag update error:", err);
    return NextResponse.json({ error: "Failed to update photo tags" }, { status: 500 });
  }
}
