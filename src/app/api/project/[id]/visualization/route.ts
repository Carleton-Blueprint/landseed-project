import { NextRequest, NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { getSignedDownloadUrlFromS3Url } from "lib/s3";
import { isPrivateS3PhotoUrl } from "lib/photoUrls";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - must be signed in" }, 
        { status: 401 }
      );
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { photos: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const canAccess = await hasProjectAccess(
      session.user.id,
      projectId,
      // Editors and owners may inspect generated visuals.
      // Viewers can also see the mock visuals, so use VIEWER access.
      undefined
    );

    if (!canAccess) {
      return NextResponse.json(
        { error: "Unauthorized access to project" },
        { status: 403 }
      );
    }

    const photos = await Promise.all(
      project.photos.map(async (photo) => {
        let generatedImageUrl: string | null;

        if (photo.generatedImageUrl) {
          // Set by a successful live generation, or by the ai-jobs worker's
          // mock fallback once live retries are exhausted — either way there's
          // an image to serve.
          generatedImageUrl = isPrivateS3PhotoUrl(photo.generatedImageUrl)
            ? await getSignedDownloadUrlFromS3Url(photo.generatedImageUrl, 900)
            : photo.generatedImageUrl;
        } else {
          // Generation is pending or in progress — leave null so callers
          // can show a pending state rather than a stale mock visual.
          generatedImageUrl = null;
        }

        return {
          id: photo.id,
          imageUrl: photo.url,
          generatedImageUrl,
        };
      })
    );

    return NextResponse.json({ success: true, projectId, photos }, { status: 200 });
  } catch (error) {
    console.error("Project visualization generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate mock accessibility visuals" },
      { status: 500 }
    );
  }
}
