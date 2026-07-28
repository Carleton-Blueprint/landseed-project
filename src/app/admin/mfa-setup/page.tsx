import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { redirectToSignIn } from "lib/auth-redirect";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { hasMinimumRole } from "@/backend/auth/requireRole";
import { MfaSetupClient } from "./MfaSetupClient";

export const metadata: Metadata = {
  title: "MFA Setup — Landseed Project Admin",
  description: "Set up multi-factor authentication for your admin account.",
};

export default async function MfaSetupPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirectToSignIn("/admin/mfa-setup");
  }

  const isAdmin = await hasMinimumRole(session, "ADMIN");
  if (!isAdmin) {
    redirect("/dashboard");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true, mfaEnrolledAt: true },
  });

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Multi-Factor Authentication</h1>
          <p className="mt-2 text-gray-600">
            Add an authenticator app (Google Authenticator, Authy, 1Password, etc.) as a second
            factor for your admin account.
          </p>
        </div>

        <MfaSetupClient
          initialMfaEnabled={user?.mfaEnabled ?? false}
          initialEnrolledAt={user?.mfaEnrolledAt?.toISOString() ?? null}
        />
      </div>
    </main>
  );
}
