import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { finalizeIntake } from "@/backend/services/finalizeIntake";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          ok: false,
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { projectId } = body;

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_REQUEST",
          message: "Missing or invalid projectId",
        },
        { status: 400 }
      );
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });

    if (!project) {
      return NextResponse.json(
        {
          ok: false,
          code: "PROJECT_NOT_FOUND",
          message: "Project not found",
        },
        { status: 404 }
      );
    }

    if (project.userId !== session.user.id) {
      return NextResponse.json(
        {
          ok: false,
          code: "ACCESS_DENIED",
          message: "Access denied",
        },
        { status: 403 }
      );
    }

    const ipAddress =
      request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null;
    const userAgent = request.headers.get("user-agent");

    const result = await finalizeIntake({
      projectId,
      actorUserId: session.user.id,
      ipAddress,
      userAgent,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[/api/intake/finalize] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        code: "FINALIZATION_ERROR",
        message: "Failed to finalize intake",
      },
      { status: 500 }
    );
  }
}
