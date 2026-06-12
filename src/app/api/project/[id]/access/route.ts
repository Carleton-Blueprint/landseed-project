import { NextRequest, NextResponse } from "next/server";
import { ProjectAccessRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { getRequestAuditContext } from "@/backend/audit/requestContext";

const VALID_ROLES = new Set<ProjectAccessRole>([
  ProjectAccessRole.OWNER,
  ProjectAccessRole.EDITOR,
  ProjectAccessRole.VIEWER,
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.NODE_ENV === "development") {
    const session = await auth();
    const actorUserId = session?.user?.id || "dev-user-id";
    const actorName = session?.user?.name || "Dev User";
    const actorEmail = session?.user?.email || "dev@example.com";
    
    const mockList = [
      {
        role: "OWNER",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
        user: { id: actorUserId, name: actorName, email: actorEmail },
      },
      {
        role: "EDITOR",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
        user: { id: "caregiver-1", name: "Dr. Sarah Jenkins (Occupational Therapist)", email: "sarah.jenkins@example.com" },
      },
      {
        role: "VIEWER",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
        user: { id: "family-1", name: "Michael Miller (Son)", email: "michael.miller@example.com" },
      },
    ];
    return NextResponse.json({ access: mockList });
  }

  const requestContext = getRequestAuditContext(request);
  const { id: projectId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "PROJECT_ACCESS_LIST_VIEW",
      outcome: "DENIED",
      sensitivityLevel: "RESTRICTED",
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Unauthenticated access list read attempt",
      ...requestContext,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canViewProject = await hasProjectAccess(session.user.id, projectId);
  if (!canViewProject) {
    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "PROJECT_ACCESS_LIST_VIEW",
      outcome: "DENIED",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Project access list read denied",
      ...requestContext,
    });
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

  await logAuditEventNonBlocking({
    category: "SENSITIVE_ACCESS",
    action: "PROJECT_ACCESS_LIST_VIEW",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: session.user.id,
    projectId,
    resourceType: "project_access",
    resourceId: projectId,
    description: "Project access list viewed",
    metadata: {
      entryCount: accessList.length,
    },
    ...requestContext,
  });

  return NextResponse.json({ access: accessList });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.NODE_ENV === "development") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { email, role } = body;
    if (!email || !role) {
      return NextResponse.json({ error: "email and role are required" }, { status: 400 });
    }
    const mockAccess = {
      role: role.toUpperCase(),
      createdAt: new Date().toISOString(),
      user: {
        id: `mock-user-${Date.now()}`,
        name: email.split("@")[0].replace(/\b\w/g, (c: string) => c.toUpperCase()),
        email: email,
      }
    };
    return NextResponse.json({ success: true, access: mockAccess });
  }

  const requestContext = getRequestAuditContext(request);
  const { id: projectId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_ACCESS_GRANT_OR_UPDATE",
      outcome: "DENIED",
      sensitivityLevel: "RESTRICTED",
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Unauthenticated project access change attempt",
      ...requestContext,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canManageAccess = await hasProjectAccess(
    session.user.id,
    projectId,
    ProjectAccessRole.OWNER
  );
  if (!canManageAccess) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_ACCESS_GRANT_OR_UPDATE",
      outcome: "DENIED",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Project access change denied because actor is not owner",
      ...requestContext,
    });
    return NextResponse.json({ error: "Only project owners can manage access" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_ACCESS_GRANT_OR_UPDATE",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Project access change rejected due to invalid JSON",
      ...requestContext,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = body as { email?: string; role?: string };
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const role =
    typeof input.role === "string" && VALID_ROLES.has(input.role as ProjectAccessRole)
      ? (input.role as ProjectAccessRole)
      : undefined;

  if (!email || !role) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_ACCESS_GRANT_OR_UPDATE",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Project access change rejected due to validation failure",
      metadata: {
        providedEmail: email,
        providedRole: input.role,
      },
      ...requestContext,
    });
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
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_ACCESS_GRANT_OR_UPDATE",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Project access change rejected because target user does not exist",
      metadata: {
        targetEmail: email,
      },
      ...requestContext,
    });
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
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_ACCESS_GRANT_OR_UPDATE",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Project access change rejected because project was not found",
      ...requestContext,
    });
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const previousAccess = await prisma.projectAccess.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: targetUser.id,
      },
    },
    select: {
      role: true,
      grantedByUserId: true,
    },
  });

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

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "PROJECT_ACCESS_GRANT_OR_UPDATE",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: session.user.id,
    projectId,
    resourceType: "project_access",
    resourceId: `${projectId}:${targetUser.id}`,
    description: "Project access granted or updated",
    beforeState: previousAccess
      ? {
          role: previousAccess.role,
          grantedByUserId: previousAccess.grantedByUserId,
        }
      : null,
    afterState: {
      role: access.role,
      grantedByUserId: session.user.id,
      targetUserId: targetUser.id,
      targetEmail: targetUser.email,
    },
    metadata: {
      enforcedRole,
    },
    ...requestContext,
  });

  return NextResponse.json({ success: true, access });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.NODE_ENV === "development") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { userId } = body;
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  }

  const requestContext = getRequestAuditContext(request);
  const { id: projectId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_ACCESS_REVOKE",
      outcome: "DENIED",
      sensitivityLevel: "RESTRICTED",
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Unauthenticated project access revoke attempt",
      ...requestContext,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canManageAccess = await hasProjectAccess(
    session.user.id,
    projectId,
    ProjectAccessRole.OWNER
  );
  if (!canManageAccess) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_ACCESS_REVOKE",
      outcome: "DENIED",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "project_access",
      resourceId: projectId,
      description: "Project access revoke denied — actor is not owner",
      ...requestContext,
    });
    return NextResponse.json({ error: "Only project owners can revoke access" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = body as { userId?: string };
  const targetUserId = typeof input.userId === "string" ? input.userId.trim() : "";

  if (!targetUserId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Look up the project to find its primary creator
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Prevent revoking the primary creator's access
  if (targetUserId === project.userId) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "PROJECT_ACCESS_REVOKE",
      outcome: "DENIED",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "project_access",
      resourceId: `${projectId}:${targetUserId}`,
      description: "Revoke denied — cannot remove primary project creator",
      ...requestContext,
    });
    return NextResponse.json(
      { error: "Cannot revoke access for the primary project creator" },
      { status: 400 }
    );
  }

  const existingAccess = await prisma.projectAccess.findUnique({
    where: { projectId_userId: { projectId, userId: targetUserId } },
    select: { role: true },
  });
  if (!existingAccess) {
    return NextResponse.json({ error: "Access record not found" }, { status: 404 });
  }

  await prisma.projectAccess.delete({
    where: { projectId_userId: { projectId, userId: targetUserId } },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "PROJECT_ACCESS_REVOKE",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: session.user.id,
    projectId,
    resourceType: "project_access",
    resourceId: `${projectId}:${targetUserId}`,
    description: "Project access revoked",
    beforeState: { role: existingAccess.role, userId: targetUserId },
    afterState: null,
    ...requestContext,
  });

  return NextResponse.json({ success: true });
}
