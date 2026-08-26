import { auth } from "@/auth";
import { redirectToSignIn } from "lib/auth-redirect";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { hasMinimumRole } from "@/backend/auth/requireRole";
import { AdminUsersPanel } from "../AdminUsersPanel";

export const metadata: Metadata = {
  title: "Admin Users — Landseed Project Admin",
  description: "Promote or demote a user's role.",
};

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user?.id) redirectToSignIn("/admin/users");
  const isAdmin = await hasMinimumRole(session, "ADMIN");
  if (!isAdmin) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <a href="/admin" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            ← Back to Admin
          </a>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">Admin Users</h1>
          <p className="mt-2 text-gray-600">Promote or demote a user&apos;s role.</p>
        </div>

        <AdminUsersPanel currentUserId={session.user.id} />
      </div>
    </main>
  );
}
