"use client";

import React from "react";
import {
  DocumentUploadInterface,
  UploadedDocument,
  DocumentCategory,
} from "@/frontend/components/DocumentUploadInterface";

const REQUIRED_CATEGORIES: DocumentCategory[] = [
  "proof_of_income",
  "property_ownership",
];

export function SupportingDocumentsSection({
  grantApplicationId,
}: {
  grantApplicationId: string;
}) {
  const handleUpload = (docs: UploadedDocument[]) => {
    // TODO: wire to POST /api/grant-applications/:id/documents once backend lands.
    console.log("Staged supporting documents:", docs);
  };

  return (
    <div className="rounded-md border p-4 bg-white shadow-sm">
      <h2 className="text-lg font-semibold mb-2">Supporting Documents</h2>
      <p className="mb-4 text-sm text-gray-600">
        Upload documents that support your grant application — proof of income,
        medical documentation, property ownership, and any other records we
        request. Each document is linked to this application.
      </p>
      <DocumentUploadInterface
        grantApplicationId={grantApplicationId}
        onUpload={handleUpload}
        requiredCategories={REQUIRED_CATEGORIES}
      />
    </div>
  );
}
