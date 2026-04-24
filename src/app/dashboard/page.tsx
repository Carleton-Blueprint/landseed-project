import { prisma } from "lib/prisma";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";
import {
  NotificationCenter,
  NotificationItem,
} from "@/frontend/components/NotificationCenter";
import { InitialEstimateSummaryCard } from "@/frontend/components/InitialEstimateSummaryCard";

function getStatusLabel(status: string) {
  if (status === "draft") return "Pending";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function getGrantSummary(project: { grantDocumentKey: string | null }) {
  if (project.grantDocumentKey) {
    return {
      applicableGrant: "Grant assessment available",
      estimatedFunding: "See generated grant PDF",
      explanation:
        "A grant assessment has been prepared for this request. Open the PDF to review applicable grants and estimated funding details.",
    };
  }

  return {
    applicableGrant: "Grant review in progress",
    estimatedFunding: "Estimate not ready yet",
    explanation:
      "We are still reviewing this request to determine which grants may apply and the estimated funding amount.",
  };
}

// TODO: replace with a real query once in-app notifications are persisted.
function getMockNotifications(projects: { id: string; address: string }[]): NotificationItem[] {
  const now = Date.now();
  const first = projects[0];
  const items: NotificationItem[] = [];

  if (first) {
    items.push({
      id: `mock-estimate-${first.id}`,
      kind: "estimate_ready",
      title: "Refined estimate ready for review",
      body: `Your refined estimate for ${first.address} is ready. Review the updated pricing and grant details.`,
      href: `/dashboard/${first.id}`,
      createdAt: new Date(now - 1000 * 60 * 12),
    });
    items.push({
      id: `mock-docs-${first.id}`,
      kind: "documents_requested",
      title: "Supporting documents requested",
      body: "Please upload proof of income and property ownership to continue your grant application.",
      href: `/dashboard/${first.id}`,
      createdAt: new Date(now - 1000 * 60 * 60 * 3),
    });
  }

  items.push({
    id: "mock-welcome",
    kind: "info",
    title: "Welcome to Landseed",
    body: "You can track every project you submit from this dashboard.",
    createdAt: new Date(now - 1000 * 60 * 60 * 26),
    read: true,
  });

  return items;
}

export default async function DashboardPage() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { photos: true },
  });

  const notifications = getMockNotifications(
    projects.map((p) => ({ id: p.id, address: p.address }))
  );

  return (
    <main className="min-h-screen max-w-4xl mx-auto p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Your Dashboard
        </h1>
        <NotificationCenter notifications={notifications} />
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">Your Projects</h2>

          {projects.length === 0 ? (
            <p className="text-gray-500">You don&apos;t have any projects yet.</p>
          ) : (
            <div className="space-y-4">
              {projects.map((project) => {
                const typedProject = project as typeof project & {
                  estimateMin?: number | null;
                  estimateMax?: number | null;
                };

                const grantSummary = getGrantSummary(project);

                return (
                  <div
                    key={project.id}
                    className="flex flex-col gap-4 rounded-md border p-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-medium text-gray-900">{project.address}</h3>

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                            project.status === "draft"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-blue-200 bg-blue-50 text-blue-700"
                          }`}
                        >
                          {getStatusLabel(project.status)}
                        </span>

                        <span className="text-sm text-gray-500">
                          {new Date(project.createdAt).toLocaleDateString()}
                        </span>

                        <span className="text-sm text-gray-500">
                          {project.photos.length} photo{project.photos.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="mt-3">
                        <InitialEstimateSummaryCard
                          projectStatus={project.status}
                          estimateMin={typedProject.estimateMin}
                          estimateMax={typedProject.estimateMax}
                          refinedEstimateReady={false}
                          compact
                        />
                      </div>

                      <div className="mt-3 rounded-md border bg-gray-50 p-3">
                        <p className="text-sm font-medium text-gray-900">
                          Applicable grants: {grantSummary.applicableGrant}
                        </p>
                        <p className="mt-1 text-sm text-gray-700">
                          Estimated funding: {grantSummary.estimatedFunding}
                        </p>
                        <p className="mt-1 text-sm text-gray-500">
                          {grantSummary.explanation}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 sm:w-auto">
                      <Link href={`/dashboard/${project.id}`}>
                        <Button variant="outline" className="w-full sm:w-auto">
                          View Details
                        </Button>
                      </Link>

                      {project.grantDocumentKey ? (
                        <Link href={`/api/documents/${project.id}/download`} target="_blank">
                          <Button
                            variant="default"
                            className="flex w-full items-center gap-2 sm:w-auto"
                          >
                            Download Grant PDF
                          </Button>
                        </Link>
                      ) : (
                        <Button variant="outline" disabled className="w-full sm:w-auto">
                          Generating PDF...
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}