/**
 * Edge-safe fast-path role check for middleware.ts ONLY. Deliberately kept
 * in its own file with no Prisma dependency (unlike requireRole.ts, which
 * imports lib/prisma at module scope) so middleware.ts's Edge bundle never
 * pulls in the Node-only Prisma client.
 *
 * requireCachedMinimumRole reads session.user.role, which is cached in the
 * JWT at sign-in (see auth.config.ts) and can be stale for up to the
 * session's lifetime after a role change in the DB. That's fine here: this
 * is NOT the authoritative check, only a filter to keep obviously
 * unauthorized requests from reaching Node at all. Every admin page
 * (admin/layout.tsx) and every /api/admin/** route handler re-verifies live
 * against the DB via requireMinimumRole / requireAdminWithMfaEnrolled
 * (requireRole.ts / requireAdminMfa.ts) regardless of what this returned —
 * that's what actually makes a demotion take effect on the very next
 * request rather than only once this cached value refreshes.
 */
import { Session } from "next-auth";
import { HttpError } from "@/backend/auth/httpError";

export function requireCachedMinimumRole(session: Session | null | undefined, requiredRole: "USER" | "ADMIN") {
  if (!session?.user?.id) throw new HttpError("unauthenticated", 401);
  if (requiredRole === "USER") return true;
  if (session.user.role !== "ADMIN") throw new HttpError("forbidden", 403);
  return true;
}
