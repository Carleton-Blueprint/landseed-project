import { NextRequest, NextResponse } from "next/server";
import {
  GrantApplicationStatus,
  NotificationEventType,
  Prisma,
  ProjectAccessRole,
} from "@prisma/client";
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
    const { address, draftData } = body;

    if (!address || typeof address !== "string") {
      return NextResponse.json(
        { error: "Address is required" },
        { status: 400 }
      );
    }

    // Create project and owner access atomically via nested create.
    const project = await prisma.project.create({
      data: {
        address,
        status: "draft",
        grantApplicationStatus: GrantApplicationStatus.DRAFT,
        userId: session.user.id,
        ...(draftData !== undefined
          ? { draftData: draftData as Prisma.InputJsonValue }
          : {}),
        projectAccess: {
          create: {
            userId: session.user.id,
            role: ProjectAccessRole.OWNER,
            grantedByUserId: session.user.id,
          },
        },
        grantApplicationStatusHistory: {
          create: {
            fromStatus: null,
            toStatus: GrantApplicationStatus.DRAFT,
            changedByUserId: session.user.id,
            metadata: {
              source: "project_create",
            } as Prisma.InputJsonValue,
          },
        },
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
