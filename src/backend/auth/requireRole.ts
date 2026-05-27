import { Session } from "next-auth";
import { prisma } from "lib/prisma";

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

function parseAllowedEmails(): string[] {
  return (process.env.ADVISORY_TEAM_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Determine whether the session user satisfies a minimal role.
 * - USER: any authenticated user
 * - STAFF: user has EDITOR or OWNER project access anywhere, or is in advisory allowlist
 * - ADMIN: advisory allowlist only (project access is not sufficient)
 */
export async function hasMinimumRole(session: Session | null | undefined, requiredRole: "USER" | "STAFF" | "ADMIN"): Promise<boolean> {
  if (!session?.user?.id) return false;

  const email = session.user.email?.toLowerCase();

  if (requiredRole === "USER") return true;

  if (requiredRole === "ADMIN") {
    return email ? parseAllowedEmails().includes(email) : false;
  }

  // STAFF: check project access (EDITOR/OWNER) or advisory allowlist
  if (email && parseAllowedEmails().includes(email)) return true;

  const access = await prisma.projectAccess.findFirst({
    where: { userId: session.user.id, role: { in: ["EDITOR", "OWNER"] } },
    select: { id: true },
  });

  return Boolean(access);
}

export async function requireMinimumRole(session: Session | null | undefined, requiredRole: "USER" | "STAFF" | "ADMIN") {
  if (!session?.user?.id) throw new HttpError("unauthenticated", 401);
  const ok = await hasMinimumRole(session, requiredRole);
  if (!ok) throw new HttpError("forbidden", 403);
  return true;
}

export { HttpError };
