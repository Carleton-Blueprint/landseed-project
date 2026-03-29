import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";
import { prisma } from "lib/prisma";

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
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;

  const project = await prisma.project.findUnique({
    where: { id: resolvedParams.id },
    include: { photos: true },
  });

  if (!project) return notFound();

  const modificationItems = modificationItemsFromDraft(project.draftData);

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6 md:p-8">
      <Link href="/dashboard">
        <Button variant="ghost">← Back to Dashboard</Button>
      </Link>

      <h1 className="mt-4 mb-6 text-3xl font-bold text-gray-900">{project.address}</h1>

      <div className="space-y-6">
        {/* Status */}
        <div className="rounded-md border p-4 bg-white shadow-sm">
          <p className="text-sm text-gray-600">
            <strong>Status:</strong>{" "}
            {project.status === "draft" ? "Pending Review" : project.status}
          </p>
          <p className="text-sm text-gray-600 mt-1">
            <strong>Submitted:</strong>{" "}
            {new Date(project.createdAt).toLocaleDateString()}
          </p>
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

        {/* Photos */}
        <div className="rounded-md border p-4 bg-white shadow-sm">
          <h2 className="text-lg font-semibold mb-2">Submitted Photos</h2>
          {project.photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {project.photos.map((photo) => (
                <Image
                  key={photo.id}
                  src={
                    photo.url ||
                    "https://placehold.co/300x200?text=No+image"
                  }
                  alt="Project photo"
                  width={300}
                  height={200}
                  className="rounded-md border"
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No photos submitted for this project.</p>
          )}
        </div>

        {/* Grant section */}
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
