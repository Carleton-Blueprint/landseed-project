import { ProjectAccessRole } from "@prisma/client";
import { prisma } from "lib/prisma";
import { isAdminUser } from "@/backend/auth/requireRole";

const ROLE_RANK: Record<ProjectAccessRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

const ACCESS_ROLES: ProjectAccessRole[] = [
  ProjectAccessRole.VIEWER,
  ProjectAccessRole.EDITOR,
  ProjectAccessRole.OWNER,
];

export async function hasProjectAccess(
  userId: string,
  projectId: string,
  minimumRole: ProjectAccessRole = ProjectAccessRole.VIEWER
): Promise<boolean> {
  if (await isAdminUser(userId)) return true;

  const access = await prisma.projectAccess.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId,
      },
    },
    select: { role: true },
  });

  if (!access) {
    return false;
  }

  return ROLE_RANK[access.role] >= ROLE_RANK[minimumRole];
}

export async function getAccessibleProjectIds(
  userId: string,
  minimumRole: ProjectAccessRole = ProjectAccessRole.VIEWER
): Promise<string[]> {
  if (await isAdminUser(userId)) {
    const allProjects = await prisma.project.findMany({ select: { id: true } });
    return allProjects.map((project) => project.id);
  }

  const rows = await prisma.projectAccess.findMany({
    where: {
      userId,
      role: {
        in: ACCESS_ROLES.filter(
          (role) => ROLE_RANK[role] >= ROLE_RANK[minimumRole]
        ),
      },
    },
    select: { projectId: true },
  });

  return rows.map((row) => row.projectId);
}
