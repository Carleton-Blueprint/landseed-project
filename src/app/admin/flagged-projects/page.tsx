import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { FlaggedProjectsClient } from "./FlaggedProjectsClient";

export const metadata: Metadata = {
  title: "Flagged Projects — Landseed Project Admin",
  description: "Projects flagged for manual review due to complexity or low AI confidence.",
};

export default async function FlaggedProjectsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/api/auth/signin?callbackUrl=/admin/flagged-projects");
  }

  const staffAccess = await prisma.projectAccess.findFirst({
    where: {
      userId: session.user.id,
      role: { in: ["EDITOR", "OWNER"] },
    },
    select: { id: true },
  });

  if (!staffAccess) {
    redirect("/dashboard");
  }

  const flaggedProjects = await prisma.projectManualReviewFlag.findMany({
    where: {
      isActive: true,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              eligibilityAssessments: true,
              quotes: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Flagged Projects</h1>
          <p className="mt-2 text-gray-600">
            Projects flagged for manual review due to high complexity or low AI confidence.
          </p>
        </div>

        <FlaggedProjectsClient flaggedProjects={flaggedProjects} />
      </div>
    </main>
  );
}
