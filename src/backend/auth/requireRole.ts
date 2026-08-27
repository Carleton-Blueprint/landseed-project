import { Session } from "next-auth";
import { prisma } from "lib/prisma";
import { HttpError } from "@/backend/auth/httpError";

/**
 * Determine whether the session user satisfies a minimal role.
 * - USER: any authenticated user
 * - ADMIN: User.role === "ADMIN" in the DB. This is a live lookup (not
 *   cached in the session/JWT), so a demotion takes effect on the user's
 *   very next request rather than waiting for their session to expire.
 *
 * Needs Prisma — a Node-only dependency. Do not import this module (or
 * anything from it) into middleware.ts, which runs on the Edge runtime;
 * use requireCachedMinimumRole (requireCachedRole.ts) there instead. Every
 * admin page (admin/layout.tsx) and every /api/admin/** route handler
 * should still call requireMinimumRole/requireAdminWithMfaEnrolled
 * directly — middleware's cached check is only a fast preliminary filter,
 * never the authoritative one.
 */
export async function isAdminUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  return user?.role === "ADMIN";
}

export async function hasMinimumRole(session: Session | null | undefined, requiredRole: "USER" | "ADMIN"): Promise<boolean> {
  if (!session?.user?.id) return false;

  if (requiredRole === "USER") return true;

  return isAdminUser(session.user.id);
}

/**
 * Emails of every DB-backed ADMIN user. Source of truth for "who are the
 * admins" — used by the daily digest, alert emails, MFA reset eligibility,
 * and advisory-team notifications.
 */
export async function getAdminEmails(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { email: true },
  });
  return admins.map((u) => u.email).filter((email): email is string => Boolean(email));
}

export async function requireMinimumRole(session: Session | null | undefined, requiredRole: "USER" | "ADMIN") {
  if (!session?.user?.id) throw new HttpError("unauthenticated", 401);
  const ok = await hasMinimumRole(session, requiredRole);
  if (!ok) throw new HttpError("forbidden", 403);
  return true;
}

export { HttpError };
