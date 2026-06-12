import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flagged Projects — Landseed Project Admin",
  description: "Projects flagged for manual review due to complexity or low AI confidence.",
};

const reasonLabel: Record<string, string> = {
  LOW_CONFIDENCE: "Low Confidence",
  HIGH_COMPLEXITY: "High Complexity",
  BOTH: "Low Confidence + High Complexity",
};

const reasonBadgeColor: Record<string, string> = {
  LOW_CONFIDENCE: "bg-yellow-100 text-yellow-800 border border-yellow-300",
  HIGH_COMPLEXITY: "bg-orange-100 text-orange-800 border border-orange-300",
  BOTH: "bg-red-100 text-red-800 border border-red-300",
};

interface FlaggedProject {
  id: string;
  reason: string;
  description: string | null;
  createdAt: Date;
  lastEvaluatedAt: Date;
  project: {
    id: string;
    name: string;
    createdAt: Date;
    user: {
      id: string;
      name: string | null;
      email: string | null;
    };
    _count: {
      eligibilityAssessments: number;
      quotes: number;
    };
  };
}

export default async function FlaggedProjectsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/api/auth/signin?callbackUrl=/admin/flagged-projects");
  }

  let flaggedProjects: FlaggedProject[] = [];
  try {
    const staffAccess = await prisma.projectAccess.findFirst({
      where: {
        userId: session.user.id,
        role: { in: ["EDITOR", "OWNER"] },
      },
      select: { id: true },
    });

    if (!staffAccess && process.env.NODE_ENV !== "development") {
      redirect("/dashboard");
    }

    const projectsWithFlags = await prisma.project.findMany({
      where: {
        manualReviewFlag: {
          isActive: true,
        },
      },
      include: {
        manualReviewFlag: true,
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
      orderBy: {
        createdAt: "desc",
      },
    });

    flaggedProjects = projectsWithFlags
      .map((project) => {
        if (!project.manualReviewFlag) {
          return null;
        }

        return {
          ...project.manualReviewFlag,
          project: {
            id: project.id,
            name: project.address,
            createdAt: project.createdAt,
            user: project.user,
            _count: project._count,
          },
        };
      })
      .filter((flaggedProject): flaggedProject is NonNullable<typeof flaggedProject> => Boolean(flaggedProject));
  } catch {
    console.log("Database fetch failed in admin flagged projects page, using empty fallback.");
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Flagged Projects</h1>
          <p className="mt-2 text-gray-600">
            Projects flagged for manual review due to high complexity or low AI confidence.
          </p>
        </div>

        {flaggedProjects.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
            No active flagged projects found.
          </div>
        ) : (
          <div className="grid gap-4">
            {flaggedProjects.map((flaggedProject) => (
              <div key={flaggedProject.id} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-lg font-semibold text-gray-900">
                          {flaggedProject.project.name}
                        </h2>
                        <p className="text-sm text-gray-500">ID: {flaggedProject.project.id}</p>
                      </div>
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${reasonBadgeColor[flaggedProject.reason]}`}>
                        {reasonLabel[flaggedProject.reason]}
                      </span>
                    </div>

                    <div className="mt-4 space-y-1 text-sm text-gray-600">
                      <p>
                        <strong>Client:</strong> {flaggedProject.project.user.name || "Unknown"} ({flaggedProject.project.user.email || "No email"})
                      </p>
                      <p>
                        <strong>Project Created:</strong> {new Date(flaggedProject.project.createdAt).toLocaleDateString()}
                      </p>
                      <p>
                        <strong>Flagged:</strong> {new Date(flaggedProject.createdAt).toLocaleDateString()}
                      </p>
                      <p>
                        <strong>Last Evaluated:</strong> {new Date(flaggedProject.lastEvaluatedAt).toLocaleDateString()}
                      </p>
                    </div>

                    {flaggedProject.description ? (
                      <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
                        <p className="text-sm text-gray-700">
                          <strong>Reason:</strong> {flaggedProject.description}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-4 flex gap-4 text-sm text-gray-600">
                      <span>
                        <strong>{flaggedProject.project._count.eligibilityAssessments}</strong> Assessments
                      </span>
                      <span>
                        <strong>{flaggedProject.project._count.quotes}</strong> Quotes
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 md:items-end">
                    <a
                      href={`/dashboard`}
                      className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      View Project
                    </a>
                    <a
                      href={`/admin`}
                      className="inline-flex items-center rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-300"
                    >
                      Back to Admin
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
