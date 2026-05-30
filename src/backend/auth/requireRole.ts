import { Session } from "next-auth";

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
 * - ADMIN: advisory allowlist only
 */
export async function hasMinimumRole(session: Session | null | undefined, requiredRole: "USER" | "ADMIN"): Promise<boolean> {
  if (!session?.user?.id) return false;

  // In dev, all authenticated users pass all role checks
  if (process.env.NODE_ENV === "development") return true;

  const email = session.user.email?.toLowerCase();

  if (requiredRole === "USER") return true;

  return email ? parseAllowedEmails().includes(email) : false;
}

export async function requireMinimumRole(session: Session | null | undefined, requiredRole: "USER" | "ADMIN") {
  if (!session?.user?.id) throw new HttpError("unauthenticated", 401);
  const ok = await hasMinimumRole(session, requiredRole);
  if (!ok) throw new HttpError("forbidden", 403);
  return true;
}

export { HttpError };
