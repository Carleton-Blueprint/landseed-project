import { NextRequest, NextResponse } from "next/server";
import { ProjectAccessRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { hasProjectAccess } from "@/backend/auth/projectAccess";

const VALID_ROLES = new Set<ProjectAccessRole>([
  ProjectAccessRole.OWNER,
  ProjectAccessRole.EDITOR,
  ProjectAccessRole.VIEWER,
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  const canViewProject = await hasProjectAccess(session.user.id, projectId);
  if (!canViewProject) {
    return NextResponse.json({ error: "Unauthorized access to project" }, { status: 403 });
  }

  const accessList = await prisma.projectAccess.findMany({
    where: { projectId },
    select: {
      role: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: [
      { role: "asc" },
      { createdAt: "asc" },
    ],
  });

  return NextResponse.json({ access: accessList });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  const canManageAccess = await hasProjectAccess(
    session.user.id,
    projectId,
    ProjectAccessRole.OWNER
  );
  if (!canManageAccess) {
    return NextResponse.json({ error: "Only project owners can manage access" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = body as { email?: string; role?: string };
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const role =
    typeof input.role === "string" && VALID_ROLES.has(input.role as ProjectAccessRole)
      ? (input.role as ProjectAccessRole)
      : undefined;

  if (!email || !role) {
    return NextResponse.json(
      { error: "email and role are required. role must be OWNER, EDITOR, or VIEWER" },
      { status: 400 }
    );
  }

  const targetUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!targetUser) {
    return NextResponse.json(
      { error: "User not found. Ask them to create an account first." },
      { status: 404 }
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const enforcedRole = project.userId === targetUser.id ? ProjectAccessRole.OWNER : role;

  const access = await prisma.projectAccess.upsert({
    where: {
      projectId_userId: {
        projectId,
        userId: targetUser.id,
      },
    },
    create: {
      projectId,
      userId: targetUser.id,
      role: enforcedRole,
      grantedByUserId: session.user.id,
    },
    update: {
      role: enforcedRole,
      grantedByUserId: session.user.id,
    },
    select: {
      projectId: true,
      role: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return NextResponse.json({ success: true, access });
}
