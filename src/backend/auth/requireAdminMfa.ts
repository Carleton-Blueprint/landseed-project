import { Session } from "next-auth";
import { prisma } from "lib/prisma";
import { requireMinimumRole } from "@/backend/auth/requireRole";

/**
 * Kept separate from requireRole.ts (which middleware.ts imports into its
 * Edge bundle) since this needs Prisma — a Node-only dependency Edge can't
 * bundle. Only import this from route handlers / Server Components, never
 * from middleware.ts.
 */
export const MFA_SETUP_REQUIRED_CODE = "MFA_SETUP_REQUIRED";

export const MFA_SETUP_REQUIRED_MESSAGE =
  "Set up multi-factor authentication before using this endpoint. Visit /admin/mfa-setup.";

export class MfaSetupRequiredError extends Error {
  readonly status = 403;
  readonly code = MFA_SETUP_REQUIRED_CODE;

  constructor(message = MFA_SETUP_REQUIRED_MESSAGE) {
    super(message);
    this.name = "MfaSetupRequiredError";
  }
}

/**
 * requireMinimumRole(session, "ADMIN") plus: blocks access if the admin
 * hasn't enrolled MFA yet. /admin/layout.tsx redirects unenrolled admins to
 * /admin/mfa-setup, but that's a page-only gate (Next.js layouts don't wrap
 * route handlers) — this closes the same gap for the API surface, so an
 * unenrolled admin's session can't be used to call admin routes directly
 * (e.g. via curl) either.
 *
 * Do not use this for the MFA enrollment routes themselves
 * (/api/admin/mfa/enroll, /api/admin/mfa/verify) — they're how an
 * unenrolled admin gets enrolled in the first place, so they call
 * requireMinimumRole directly instead.
 */
export async function requireAdminWithMfaEnrolled(session: Session | null | undefined): Promise<true> {
  await requireMinimumRole(session, "ADMIN");

  const user = await prisma.user.findUnique({
    where: { id: session!.user!.id },
    select: { mfaEnabled: true },
  });

  if (!user?.mfaEnabled) {
    throw new MfaSetupRequiredError();
  }

  return true;
}
