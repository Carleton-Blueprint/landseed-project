import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { hasMinimumRole } from "@/backend/auth/requireRole";

const MFA_SETUP_PATH = "/admin/mfa-setup";

/**
 * Forces any admin without MFA enrolled to /admin/mfa-setup before they can
 * use any other /admin page. middleware.ts already requires the ADMIN role
 * for this whole subtree — this only adds the MFA gate on top, and runs
 * here (Node runtime) rather than in middleware (Edge runtime, no Prisma).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    return <>{children}</>;
  }

  const isAdmin = await hasMinimumRole(session, "ADMIN");
  if (!isAdmin) {
    return <>{children}</>;
  }

  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname === MFA_SETUP_PATH) {
    return <>{children}</>;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true },
  });

  if (!user?.mfaEnabled) {
    redirect(MFA_SETUP_PATH);
  }

  return <>{children}</>;
}
