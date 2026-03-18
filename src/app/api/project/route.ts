import { NextRequest, NextResponse } from "next/server";
import { NotificationEventType } from "@prisma/client";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { enqueueNotification } from "@/backend/notifications/enqueue";

/**
 * POST /api/project
 * Create a new Project for the authenticated user
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - must be signed in" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { address } = body;

    if (!address || typeof address !== "string") {
      return NextResponse.json(
        { error: "Address is required" },
        { status: 400 }
      );
    }

    // Create project
    const project = await prisma.project.create({
      data: {
        address,
        status: "draft",
        userId: session.user.id,
      },
    });

    if (session.user.email) {
      await enqueueNotification({
        eventType: NotificationEventType.SUBMISSION_RECEIPT,
        idempotencyKey: `submission-receipt:${project.id}`,
        recipientEmail: session.user.email,
        recipientName: session.user.name,
        userId: session.user.id,
        projectId: project.id,
        projectAddress: project.address,
      });
    }

    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (error) {
    console.error("Project creation error:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
