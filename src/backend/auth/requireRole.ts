import { Session } from "next-auth";

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/** Exported for callers that need the full allowlist (e.g. listing admins to reset MFA for), not just a single-email check. */
export function parseAllowedEmails(): string[] {
  return (process.env.ADVISORY_TEAM_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Standalone allowlist check, usable before a Session exists (e.g. inside
 * NextAuth's authorize() callback, which runs pre-session).
 */
export function isAdvisoryTeamEmail(email: string | null | undefined): boolean {
  return email ? parseAllowedEmails().includes(email.toLowerCase()) : false;
}

/**
 * Determine whether the session user satisfies a minimal role.
 * - USER: any authenticated user
 * - ADMIN: advisory allowlist only
 */
export async function hasMinimumRole(session: Session | null | undefined, requiredRole: "USER" | "ADMIN"): Promise<boolean> {
  if (!session?.user?.id) return false;

  if (requiredRole === "USER") return true;

  return isAdvisoryTeamEmail(session.user.email);
}

export async function requireMinimumRole(session: Session | null | undefined, requiredRole: "USER" | "ADMIN") {
  if (!session?.user?.id) throw new HttpError("unauthenticated", 401);
  const ok = await hasMinimumRole(session, requiredRole);
  if (!ok) throw new HttpError("forbidden", 403);
  return true;
}

export { HttpError };
