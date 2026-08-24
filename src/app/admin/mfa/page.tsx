import { auth } from "@/auth";
import { redirectToSignIn } from "lib/auth-redirect";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { hasMinimumRole } from "@/backend/auth/requireRole";
import { AdminMfaPanel } from "../AdminMfaPanel";

export const metadata: Metadata = {
  title: "Admin MFA Enrollment — Landseed Project Admin",
  description: "View admin MFA enrollment status and reset another admin's enrollment.",
};

export default async function AdminMfaPage() {
  const session = await auth();
  if (!session?.user?.id) redirectToSignIn("/admin/mfa");
  const isAdmin = await hasMinimumRole(session, "ADMIN");
  if (!isAdmin) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <a href="/admin" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            ← Back to Admin
          </a>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">Admin MFA Enrollment</h1>
          <p className="mt-2 text-gray-600">
            View which admins have MFA enrolled, and reset another admin&apos;s enrollment (lost/broken/stolen
            device recovery).
          </p>
        </div>

        <AdminMfaPanel currentUserId={session.user.id} />
      </div>
    </main>
  );
}
