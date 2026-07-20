import { NextRequest, NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { getSignedDownloadUrlFromS3Url } from "lib/s3";
import { isLiveImageGenerationEnabled } from "lib/openai";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { generateMockAccessibilityVisual, modificationItemsFromDraft } from "@/backend/services/imageGeneration";

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

    const modificationItems = modificationItemsFromDraft(project.draftData);

    const photos = await Promise.all(
      project.photos.map(async (photo) => {
        let generatedImageUrl: string | null;

        if (photo.generationStatus === "READY" && photo.generatedImageUrl) {
          generatedImageUrl = photo.generatedImageUrl.includes(".amazonaws.com")
            ? await getSignedDownloadUrlFromS3Url(photo.generatedImageUrl, 900)
            : photo.generatedImageUrl;
        } else if (isLiveImageGenerationEnabled()) {
          // Generation is pending, in progress, or failed — leave null so callers
          // can show a pending/placeholder state rather than a stale mock visual.
          generatedImageUrl = null;
        } else {
          generatedImageUrl = await generateMockAccessibilityVisual(photo.url, {
            modificationCodes: modificationItems,
          });
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
