"use client";

import React, { useEffect, useState, useRef } from "react";
import { Button } from "@/frontend/components/ui/button";

interface AdminDocument {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  documentType: string;
  label: string | null;
  virusScanStatus: string;
  reviewStatus: string;
  reviewNote: string | null;
  createdAt: string;
  isClientVisible: boolean;
}

export function ProjectAdminDocuments({
  projectId,
}: {
  projectId: string;
}) {
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("OTHER");
  const [isClientVisible, setIsClientVisible] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/admin/projects/${projectId}/documents`);
      if (!res.ok) {
        throw new Error("Failed to load documents");
      }
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentType", docType);
      formData.append("isClientVisible", isClientVisible.toString());

      const res = await fetch(`/api/admin/projects/${projectId}/documents`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to upload document");
      }

      const data = await res.json();
      setDocuments([data.document, ...documents]);

      setFile(null);
      setDocType("OTHER");
      setIsClientVisible(true);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const handleToggleVisibility = async (documentId: string, currentVisibility: boolean) => {
    try {
      const newVisibility = !currentVisibility;
      // update locally first so the UI feels fast
      setDocuments(docs => docs.map(d => d.id === documentId ? { ...d, isClientVisible: newVisibility } : d));

      const res = await fetch(`/api/admin/projects/${projectId}/documents/${documentId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isClientVisible: newVisibility }),
      });

      if (!res.ok) {
        // roll back if the api call fails
        setDocuments(docs => docs.map(d => d.id === documentId ? { ...d, isClientVisible: currentVisibility } : d));
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update visibility");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update visibility");
    }
  };

  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          Project Documents
        </h3>
      </div>

      <form onSubmit={handleUpload} className="space-y-3 p-4 bg-gray-50 rounded-md border border-gray-200">
        <h4 className="text-sm font-semibold text-gray-700">Upload New Document</h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">File</label>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              disabled={uploading}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Document Type</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 bg-white"
              disabled={uploading}
            >
              <option value="MANUAL_MODE_DRAWING">Drawing</option>
              <option value="VENDOR_QUOTE">Vendor Quote</option>
              <option value="OTHER">Other / Specification</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isClientVisible}
              onChange={(e) => setIsClientVisible(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              disabled={uploading}
            />
            <span className="text-sm font-medium text-gray-700">Visible to Client</span>
          </label>

          <Button
            type="submit"
            disabled={!file || uploading}
            className="bg-blue-600 hover:bg-blue-700 text-white border-none"
          >
            {uploading ? "Uploading..." : "Upload Document"}
          </Button>
        </div>
      </form>

      {loading ? (
        <div className="py-4 text-center text-sm text-gray-500">Loading documents...</div>
      ) : error ? (
        <div className="py-4 text-center text-sm text-red-600">{error}</div>
      ) : documents.length === 0 ? (
        <div className="py-4 text-center text-sm text-gray-400 italic">No documents uploaded yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Upload Date</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client Visibility</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {doc.fileName}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {doc.documentType}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    <button
                      onClick={() => handleToggleVisibility(doc.id, doc.isClientVisible)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${
                        doc.isClientVisible ? 'bg-emerald-500' : 'bg-gray-200'
                      }`}
                      role="switch"
                      aria-checked={doc.isClientVisible}
                    >
                      <span className="sr-only">Toggle visibility</span>
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          doc.isClientVisible ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="ml-2 text-xs text-gray-500">
                      {doc.isClientVisible ? 'Visible' : 'Admin Only'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
