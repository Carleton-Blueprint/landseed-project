"use client";

import { DocumentUploadInterface } from "@/frontend/components/DocumentUploadInterface";

export function DocumentUploadClient({ projectId }: { projectId: string }) {
  return <DocumentUploadInterface projectId={projectId} />;
}
