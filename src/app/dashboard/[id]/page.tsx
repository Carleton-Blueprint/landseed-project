import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ProjectVisualizationGallery } from "./ProjectVisualizationGallery";

function getStatusLabel(status: string) {
  if (status === "draft") return "Pending Review";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function getEstimateSummary(project: {
  status: string;
  estimateMin?: number | null;
  estimateMax?: number | null;
}) {
  const isFinalized = project.status !== "draft";

  if (!isFinalized) {
    return {
      value: "Available after intake finalization",
      explanation:
        "Your initial estimate range will appear here after intake finalization. Pricing is dynamically generated from real-time external retail data.",
    };
  }

  if (project.estimateMin != null && project.estimateMax != null) {
    return {
      value: `$${project.estimateMin.toLocaleString()} - $${project.estimateMax.toLocaleString()}`,
      explanation:
        "This pricing is dynamically generated from real-time external retail data and may change as retailer pricing and product availability update.",
    };
  }

  return {
    value: "Generating estimate...",
    explanation:
      "We are generating your estimate using real-time external retail data.",
  };
}

function modificationItemsFromDraft(draftData: unknown): string[] {
  if (!draftData || typeof draftData !== "object" || Array.isArray(draftData)) {
    return [];
  }
  const raw = (draftData as Record<string, unknown>).modificationItems;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const resolvedParams = await params;
  const session = await auth();

  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=/dashboard/${resolvedParams.id}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: resolvedParams.id },
    include: {
      photos: true,
      projectAccess: {
        where: { userId: session.user.id },
        select: { userId: true },
      },
    },
  });

  if (!project) return notFound();
  if (project.projectAccess.length === 0) return notFound();

  const modificationItems = modificationItemsFromDraft(project.draftData);

  const typedProject = project as typeof project & {
    estimateMin?: number | null;
    estimateMax?: number | null;
  };

  const estimateSummary = getEstimateSummary(typedProject);

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6 md:p-8">
      <Link href="/dashboard">
        <Button variant="ghost">← Back to Dashboard</Button>
      </Link>

      <h1 className="mt-4 mb-6 text-3xl font-bold text-gray-900">
        {project.address}
      </h1>

      <div className="space-y-6">
        <div className="rounded-md border p-4 bg-white shadow-sm">
          <p className="text-sm text-gray-600">
            <strong>Status:</strong> {getStatusLabel(project.status)}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            <strong>Submitted:</strong>{" "}
            {new Date(project.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className="rounded-md border p-4 bg-white shadow-sm">
          <h2 className="text-lg font-semibold mb-2">Initial Estimate Range</h2>
          <p className="text-sm text-gray-700">{estimateSummary.value}</p>
          <p className="mt-2 text-sm text-gray-500">{estimateSummary.explanation}</p>
        </div>

        {modificationItems.length > 0 && (
          <div className="rounded-md border p-4 bg-white shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Modification Items</h2>
            <ul className="list-disc list-inside text-sm text-gray-700">
              {modificationItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <ProjectVisualizationGallery
          photos={project.photos.map((photo) => ({
            id: photo.id,
            imageUrl: ("imageUrl" in photo ? (photo as { imageUrl?: string | null }).imageUrl : null) ?? photo.url,
            generatedImageUrl:
              "generatedImageUrl" in photo
                ? (photo as { generatedImageUrl?: string | null }).generatedImageUrl ?? null
                : null,
          }))}
        />

        <div className="rounded-md border p-4 bg-white shadow-sm">
          <h2 className="text-lg font-semibold mb-2">Grant Assessment</h2>
          {project.grantDocumentKey ? (
            <Link href={`/api/documents/${project.id}/download`} target="_blank">
              <Button variant="default">Download Grant PDF</Button>
            </Link>
          ) : (
            <p className="text-sm text-gray-500">Grant PDF is still being generated.</p>
          )}
        </div>
      </div>
    </main>
  );
}