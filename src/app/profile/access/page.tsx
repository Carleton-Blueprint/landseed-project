/**
 * /profile/access — Server-rendered access management page.
 * Loads all projects the current user owns (or has any access to),
 * then passes structured data to AccessManagementClient for interactive management.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import {
  AccessManagementClient,
  type ProjectWithAccess,
} from "@/frontend/components/AccessManagementClient";

export const metadata = {
  title: "Share Access — Landseed",
  description: "Manage trusted access to your projects.",
};

export default async function AccessManagementPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin?callbackUrl=/profile/access");

  const userId = session.user.id;
  let projects: ProjectWithAccess[] = [];

  try {
    const projectRows = await prisma.project.findMany({
      where: { projectAccess: { some: { userId } } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        address: true,
        userId: true,
        projectAccess: {
          select: {
            role: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    projects = projectRows.map((p) => ({
      id: p.id,
      address: p.address,
      userId: p.userId,
      accessList: p.projectAccess.map((a) => ({
        role: a.role as "OWNER" | "EDITOR" | "VIEWER",
        createdAt: a.createdAt.toISOString(),
        user: { id: a.user.id, name: a.user.name, email: a.user.email },
      })),
    }));
  } catch {
    // No DB in dev — renders empty access list
  }

  if (projects.length === 0 && process.env.NODE_ENV === "development") {
    projects = [
      {
        id: "mock-project-1",
        address: "124 Emerald Forest Drive",
        userId: userId,
        accessList: [
          {
            role: "OWNER",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
            user: { id: userId, name: session.user.name ?? "Dev User", email: session.user.email ?? "dev@example.com" },
          },
          {
            role: "EDITOR",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
            user: { id: "caregiver-1", name: "Dr. Sarah Jenkins (Occupational Therapist)", email: "sarah.jenkins@example.com" },
          },
          {
            role: "VIEWER",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
            user: { id: "family-1", name: "Michael Miller (Son)", email: "michael.miller@example.com" },
          },
        ],
      },
      {
        id: "mock-project-2",
        address: "88 Silver Maple Court",
        userId: "other-user-id",
        accessList: [
          {
            role: "OWNER",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString(),
            user: { id: "other-user-id", name: "Eleanor Vance (Mother)", email: "eleanor.vance@example.com" },
          },
          {
            role: "EDITOR",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString(),
            user: { id: userId, name: session.user.name ?? "Dev User", email: session.user.email ?? "dev@example.com" },
          },
        ],
      },
    ];
  }

  const ownedCount = projects.filter((p) =>
    p.accessList.some((m) => m.user.id === userId && m.role === "OWNER")
  ).length;

  return (
    <main className="relative min-h-screen bg-gray-50">
      {/* Subtle animated background matching dashboard */}
      <style>{`
        @keyframes drift-access {
          from { background-position: 0 0; }
          to { background-position: 200px -200px; }
        }
        .bg-access-pattern {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='0.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3Cpath d='M23 21v-2a4 4 0 0 0-3-3.87'/%3E%3Cpath d='M16 3.13a4 4 0 0 1 0 7.75'/%3E%3C/svg%3E");
          background-size: 160px 160px;
          animation: drift-access 60s linear infinite;
        }
      `}</style>
      <div className="fixed inset-0 -z-10 bg-access-pattern opacity-[0.07] pointer-events-none" />

      {/* Page header */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-3xl px-6 py-6 md:px-8">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-xs text-gray-500">
            <Link href="/profile" className="hover:text-gray-700 transition-colors">
              Profile
            </Link>
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            <span className="font-medium text-gray-900">Share Access</span>
          </nav>

          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                Share Access
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage access permissions for your family members and caregivers.
              </p>
            </div>

            {/* Stats pill */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
                <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
                </svg>
                <span className="text-xs font-medium text-gray-700">
                  {projects.length} project{projects.length !== 1 ? "s" : ""}
                </span>
              </div>
              {ownedCount > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5">
                  <svg className="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                  <span className="text-xs font-medium text-indigo-700">
                    Owner of {ownedCount}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info banner explaining roles */}
      <div className="border-b bg-gradient-to-r from-emerald-50 to-teal-50">
        <div className="mx-auto max-w-3xl px-6 py-3 md:px-8">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-gray-600">
            <span className="font-semibold text-gray-700">Permission levels:</span>
            <span>
              <span className="mr-1 inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Viewer</span>
              View project data only
            </span>
            <span>
              <span className="mr-1 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Editor</span>
              View &amp; edit project data
            </span>
            <span>
              <span className="mr-1 inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Owner</span>
              Full access + manage permissions
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto max-w-3xl px-6 py-8 md:px-8">
        <AccessManagementClient
          projects={projects}
          currentUserId={userId}
        />
      </div>
    </main>
  );
}
