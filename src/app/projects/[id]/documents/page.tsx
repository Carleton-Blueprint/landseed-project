/**
 * Supporting Documents page: allows clients to upload required supporting documents
 * (proof of income, medical documentation, etc.) for their grant application.
 * Server component that renders the DocumentUploadInterface client component.
 */
import { Metadata } from "next";
import Link from "next/link";
import { DocumentUploadClient } from "./DocumentUploadClient";

export const metadata: Metadata = {
  title: "Upload Supporting Documents | Landseed Project",
  description:
    "Upload required supporting documents such as proof of income, medical documentation, and identification for your grant application.",
};

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white" role="main">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-gray-500" aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-gray-700 transition-colors">
                Home
              </Link>
            </li>
            <li className="text-gray-300">/</li>
            <li>
              <Link
                href={`/projects/${id}`}
                className="hover:text-gray-700 transition-colors"
              >
                Project
              </Link>
            </li>
            <li className="text-gray-300">/</li>
            <li className="text-gray-800 font-medium">Documents</li>
          </ol>
        </nav>

        <DocumentUploadClient projectId={id} />
      </div>
    </main>
  );
}
