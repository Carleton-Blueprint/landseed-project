"use client";

import React from "react";
import { DocumentUploadInterface } from "@/frontend/components/DocumentUploadInterface";

export function SupportingDocumentsSection({
  grantApplicationId,
}: {
  grantApplicationId: string;
}) {
  return (
    <div className="rounded-md border p-4 bg-white shadow-sm">
      <h2 className="text-lg font-semibold mb-2">Supporting Documents</h2>
      <p className="mb-4 text-sm text-gray-600">
        Upload documents that support your grant application — proof of income,
        medical documentation, property ownership, and any other records we
        request. Each document is linked to this application.
      </p>
      <DocumentUploadInterface projectId={grantApplicationId} />
    </div>
  );
}
