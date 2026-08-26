import { auth } from "@/auth";
import { redirectToSignIn } from "lib/auth-redirect";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { hasMinimumRole } from "@/backend/auth/requireRole";
import { AdminAlertThresholdsPanel } from "../AdminAlertThresholdsPanel";

export const metadata: Metadata = {
  title: "Monitoring Alert Thresholds — Landseed Project Admin",
  description: "Configure the failure-count/window thresholds that trigger admin alerts.",
};

export default async function AdminAlertThresholdsPage() {
  const session = await auth();
  if (!session?.user?.id) redirectToSignIn("/admin/alert-thresholds");
  const isAdmin = await hasMinimumRole(session, "ADMIN");
  if (!isAdmin) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <a href="/admin" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            ← Back to Admin
          </a>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">Monitoring Alert Thresholds</h1>
          <p className="mt-2 text-gray-600">
            Configure the failure-count/window thresholds (AI job, BuilderTrend transfer, email delivery, file
            scan) that trigger admin alerts.
          </p>
        </div>

        <AdminAlertThresholdsPanel />
      </div>
    </main>
  );
}
