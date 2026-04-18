import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";
import { prisma } from "lib/prisma";
import { ProjectVisualizationGallery } from "./ProjectVisualizationGallery";
import { SupportingDocumentsSection } from "./SupportingDocumentsSection";

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

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { photos: true },
  });

  if (!project) return notFound();

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

        {project.modificationItems && project.modificationItems.length > 0 && (
          <div className="rounded-md border p-4 bg-white shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Modification Items</h2>
            <ul className="list-disc list-inside text-sm text-gray-700">
              {project.modificationItems.map((item: string) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <ProjectVisualizationGallery
          photos={project.photos.map((photo) => ({
            id: photo.id,
            imageUrl: photo.imageUrl,
            generatedImageUrl:
              "generatedImageUrl" in photo ? (photo as any).generatedImageUrl : null,
          }))}
        />

        <SupportingDocumentsSection grantApplicationId={project.id} />

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