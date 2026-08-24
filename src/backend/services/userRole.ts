/**
 * Admin user-role management: list every user with their current role, and
 * promote/demote a user between USER and ADMIN. Mirrors mfaReset.ts's shape
 * (self-service guardrail, typed error class, audit logging).
 */

import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export const USER_ROLE_CHANGE_AUDIT_ACTION = "USER_ROLE_CHANGE";

type UserRoleErrorCode = "TARGET_NOT_FOUND" | "CANNOT_CHANGE_OWN_ROLE" | "CANNOT_DEMOTE_LAST_ADMIN";

export class UserRoleError extends Error {
  statusCode: number;
  code: UserRoleErrorCode;

  constructor(message: string, statusCode: number, code: UserRoleErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface UserWithRole {
  id: string;
  name: string | null;
  email: string | null;
  role: "USER" | "ADMIN";
}

/** Lists every user with their current role, for the admin user-management picker. */
export async function listUsersWithRoles(): Promise<UserWithRole[]> {
  return prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { email: "asc" },
  });
}

export interface UpdateUserRoleInput {
  targetUserId: string;
  newRole: "USER" | "ADMIN";
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function updateUserRole(input: UpdateUserRoleInput): Promise<UserWithRole> {
  const { targetUserId, newRole, actorUserId, ipAddress, userAgent } = input;

  if (targetUserId === actorUserId) {
    throw new UserRoleError(
      "You can't change your own role — ask another admin to do it for you",
      400,
      "CANNOT_CHANGE_OWN_ROLE"
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!target) {
    throw new UserRoleError("Target user not found", 404, "TARGET_NOT_FOUND");
  }

  if (target.role === newRole) {
    return target;
  }

  // Guard against demoting the last remaining admin. Re-checked inside the
  // transaction (not just from the read above) to narrow the race against a
  // concurrent demotion of a different admin — mirrors the re-check pattern
  // in modificationOverride.ts.
  let blockedLastAdmin = false;
  const updated = await prisma.$transaction(async (tx) => {
    if (target.role === "ADMIN" && newRole === "USER") {
      const adminCount = await tx.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        blockedLastAdmin = true;
        return null;
      }
    }

    return tx.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
      select: { id: true, name: true, email: true, role: true },
    });
  });

  if (blockedLastAdmin || !updated) {
    throw new UserRoleError(
      "Can't demote the last remaining admin — promote another user first",
      409,
      "CANNOT_DEMOTE_LAST_ADMIN"
    );
  }

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: USER_ROLE_CHANGE_AUDIT_ACTION,
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId,
    resourceType: "user_role",
    resourceId: targetUserId,
    description: `Changed role for ${target.email ?? targetUserId} from ${target.role} to ${newRole}`,
    metadata: { targetUserId, targetEmail: target.email },
    beforeState: { role: target.role },
    afterState: { role: newRole },
    ipAddress,
    userAgent,
  });

  return updated;
}
