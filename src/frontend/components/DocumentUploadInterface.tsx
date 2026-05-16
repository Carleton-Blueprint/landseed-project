"use client";

import React, { useCallback, useState, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import {
  DollarIcon,
  HomeIcon,
  FileIcon,
  ClipboardIcon,
  AlertTriangleIcon,
} from "@/frontend/components/icons";

/* ──────────────────────────── Types ──────────────────────────── */

export type DocumentCategory = {
  value: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  required?: boolean;
};

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  {
    value: "PROOF_OF_INCOME",
    label: "Proof of Income",
    description: "Recent pay stubs, tax returns, or income verification letter",
    icon: <DollarIcon size={20} className="text-emerald-600" />,
    required: true,
  },
  {
    value: "MEDICAL_DOCUMENTATION",
    label: "Medical Documentation",
    description: "Doctor's letter, medical reports, or disability documentation",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
    required: true,
  },
  {
    value: "PROPERTY_OWNERSHIP",
    label: "Property Ownership",
    description: "Property deed, mortgage statement, or rental agreement",
    icon: <HomeIcon size={20} className="text-indigo-600" />,
  },
  {
    value: "INSURANCE_DOCUMENT",
    label: "Insurance Document",
    description: "Home insurance policy or coverage details",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-600"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  },
  {
    value: "GOVERNMENT_ID",
    label: "Government ID",
    description: "Driver's licence, passport, or provincial health card",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>,
    required: true,
  },
  {
    value: "TAX_ASSESSMENT",
    label: "Tax Assessment",
    description: "Notice of assessment or property tax bill",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-600"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
  },
  {
    value: "DISABILITY_CERTIFICATE",
    label: "Disability Certificate",
    description: "Provincial disability verification or certificate",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-600"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>,
  },
  {
    value: "OTHER",
    label: "Other Document",
    description: "Any other supporting documents for your application",
    icon: <FileIcon size={20} className="text-gray-500" />,
  },
];

interface UploadedDoc {
  id: string;
  fileName: string;
  fileSize: number;
  documentType: string;
  virusScanStatus: string;
  reviewStatus: string;
  createdAt: string;
}

interface QueuedFile {
  file: File;
  documentType: string;
  label?: string;
  progress: number;
  status: "queued" | "uploading" | "success" | "error";
  error?: string;
  result?: UploadedDoc;
}

export interface DocumentUploadInterfaceProps {
  projectId: string;
  onUploadComplete?: (documents: UploadedDoc[]) => void;
}

/* ──────────────────────────── Helpers ──────────────────────────── */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusColor(status: string) {
  switch (status) {
    case "pending":
      return "text-amber-600 bg-amber-50 border-amber-200";
    case "clean":
      return "text-emerald-600 bg-emerald-50 border-emerald-200";
    case "infected":
      return "text-red-600 bg-red-50 border-red-200";
    default:
      return "text-gray-600 bg-gray-50 border-gray-200";
  }
}

function getReviewBadge(status: string) {
  switch (status) {
    case "APPROVED":
      return { text: "Approved", classes: "text-emerald-700 bg-emerald-50 border-emerald-200" };
    case "REJECTED":
      return { text: "Rejected", classes: "text-red-700 bg-red-50 border-red-200" };
    default:
      return { text: "Pending Review", classes: "text-amber-700 bg-amber-50 border-amber-200" };
  }
}

/* ──────────────────────────── Component ──────────────────────────── */

export function DocumentUploadInterface({
  projectId,
  onUploadComplete,
}: DocumentUploadInterfaceProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch existing documents on mount
  useEffect(() => {
    async function fetchDocs() {
      try {
        const res = await fetch(`/api/documents/list/${projectId}`);
        if (res.ok) {
          const data = await res.json();
          setUploadedDocs(data.documents || []);
        }
      } catch {
        console.error("Failed to fetch documents");
      } finally {
        setIsLoadingDocs(false);
      }
    }
    fetchDocs();
  }, [projectId]);

  // Upload a queued file
  const uploadFile = useCallback(
    async (queuedFile: QueuedFile, index: number) => {
      setQueuedFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: "uploading" as const, progress: 10 } : f))
      );

      const formData = new FormData();
      formData.append("file", queuedFile.file);
      formData.append("projectId", projectId);
      formData.append("documentType", queuedFile.documentType);
      if (queuedFile.label) {
        formData.append("label", queuedFile.label);
      }

      // Simulate progress
      const progressInterval = setInterval(() => {
        if (!projectId) { clearInterval(progressInterval); return; }
        setQueuedFiles((prev) =>
          prev.map((f, i) =>
            i === index && f.status === "uploading"
              ? { ...f, progress: Math.min(f.progress + Math.random() * 15 + 5, 90) }
              : f
          )
        );
      }, 300);

      try {
        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });

        clearInterval(progressInterval);

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Upload failed");
        }

        const data = await res.json();

        setQueuedFiles((prev) =>
          prev.map((f, i) =>
            i === index
              ? { ...f, status: "success" as const, progress: 100, result: data.document }
              : f
          )
        );

        setUploadedDocs((prev) => [data.document, ...prev]);
      } catch (err) {
        clearInterval(progressInterval);
        setQueuedFiles((prev) =>
          prev.map((f, i) =>
            i === index
              ? {
                  ...f,
                  status: "error" as const,
                  progress: 0,
                  error: err instanceof Error ? err.message : "Upload failed",
                }
              : f
          )
        );
      }
    },
    [projectId]
  );

  // Handle files dropped or selected
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!selectedCategory) {
        setGlobalError("Please select a document category first.");
        return;
      }
      setGlobalError(null);

      const newQueued: QueuedFile[] = acceptedFiles.map((file) => ({
        file,
        documentType: selectedCategory,
        progress: 0,
        status: "queued" as const,
      }));

      const startIndex = queuedFiles.length;
      setQueuedFiles((prev) => [...prev, ...newQueued]);

      // Start uploads
      newQueued.forEach((qf, i) => {
        uploadFile(qf, startIndex + i);
      });
    },
    [selectedCategory, queuedFiles.length, uploadFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    maxSize: 15 * 1024 * 1024,
    disabled: !selectedCategory,
  });

  // Delete document
  const handleDelete = async (docId: string) => {
    setDeletingId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (res.ok) {
        setUploadedDocs((prev) => prev.filter((d) => d.id !== docId));
      }
    } catch {
      console.error("Failed to delete document");
    } finally {
      setDeletingId(null);
    }
  };

  // Remove from queue
  const removeFromQueue = (index: number) => {
    setQueuedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Notify parent when uploads complete
  useEffect(() => {
    if (onUploadComplete && uploadedDocs.length > 0) {
      onUploadComplete(uploadedDocs);
    }
  }, [uploadedDocs, onUploadComplete]);

  const selectedCategoryInfo = DOCUMENT_CATEGORIES.find(
    (c) => c.value === selectedCategory
  );

  const completedByType = uploadedDocs.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.documentType] = (acc[doc.documentType] || 0) + 1;
    return acc;
  }, {});

  const requiredCategories = DOCUMENT_CATEGORIES.filter((c) => c.required);
  const completedRequired = requiredCategories.filter(
    (c) => completedByType[c.value]
  );

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* ─── Header ─── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 p-8 text-white shadow-2xl">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-blue-500/20 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-emerald-500/15 to-transparent rounded-full blur-2xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20">
              <FileIcon size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Supporting Documents</h2>
              <p className="text-slate-300 text-sm">
                Upload required documents for your grant application
              </p>
            </div>
          </div>

          {/* Progress indicator */}
          <div className="mt-6 flex items-center gap-4">
            <div className="flex-1 bg-white/10 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-blue-400 rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${requiredCategories.length > 0 ? (completedRequired.length / requiredCategories.length) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="text-sm font-medium text-slate-300 whitespace-nowrap">
              {completedRequired.length}/{requiredCategories.length} required
            </span>
          </div>
        </div>
      </div>

      {/* ─── Category Selector ─── */}
      <div>
        <h3 className="text-lg font-semibold text-gray-800 mb-1">
          Step 1: Select Document Type
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Choose the type of document you want to upload.
          <span className="text-red-500 ml-1">* = required</span>
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {DOCUMENT_CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.value;
            const isCompleted = !!completedByType[cat.value];

            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => {
                  setSelectedCategory(cat.value);
                  setGlobalError(null);
                }}
                className={`
                  relative text-left p-4 rounded-xl border-2 transition-all duration-200
                  hover:shadow-md hover:-translate-y-0.5 group
                  ${isSelected
                    ? "border-blue-500 bg-blue-50 shadow-md shadow-blue-100"
                    : isCompleted
                    ? "border-emerald-300 bg-emerald-50/50 hover:border-emerald-400"
                    : "border-gray-200 bg-white hover:border-gray-300"
                  }
                `}
              >
                {/* Completed badge */}
                {isCompleted && (
                  <div className="absolute top-2 right-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold">
                      ✓
                    </span>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <span className="text-2xl mt-0.5 group-hover:scale-110 transition-transform duration-200">
                    {cat.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800 text-sm">
                        {cat.label}
                      </span>
                      {cat.required && (
                        <span className="text-red-500 text-xs font-bold">*</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                      {cat.description}
                    </p>
                    {isCompleted && (
                      <p className="text-xs text-emerald-600 font-medium mt-1">
                        {completedByType[cat.value]} uploaded
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Upload Area ─── */}
      <div>
        <h3 className="text-lg font-semibold text-gray-800 mb-1">
          Step 2: Upload Your Document
        </h3>
        {selectedCategoryInfo ? (
          <p className="text-sm text-gray-500 mb-4">
            Uploading: <span className="font-semibold">{selectedCategoryInfo.icon} {selectedCategoryInfo.label}</span>
          </p>
        ) : (
            <p className="text-sm text-amber-600 mb-4 flex items-center gap-1.5">
              <AlertTriangleIcon size={14} /> Please select a document type above first
          </p>
        )}

        <div
          {...getRootProps()}
          className={`
            relative overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer
            transition-all duration-300 group
            ${!selectedCategory
              ? "border-gray-200 bg-gray-50 cursor-not-allowed opacity-60"
              : isDragActive
              ? "border-blue-500 bg-blue-50 scale-[1.02] shadow-lg shadow-blue-100"
              : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/30 hover:shadow-md"
            }
          `}
        >
          <input {...getInputProps()} />

          {/* Background decoration */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-purple-50/30 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="relative z-10">
            <div
              className={`
                mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-4
                transition-all duration-300
                ${isDragActive
                  ? "bg-blue-100 scale-110"
                  : "bg-gray-100 group-hover:bg-blue-100 group-hover:scale-105"
                }
              `}
            >
              <svg
                className={`w-8 h-8 transition-colors duration-300 ${
                  isDragActive ? "text-blue-600" : "text-gray-400 group-hover:text-blue-500"
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>

            <p className="font-semibold text-gray-700 text-lg">
              {isDragActive
                ? "Drop your document here..."
                : selectedCategory
                ? "Click to browse or drag your document here"
                : "Select a document type above"}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Supports PDF, JPEG, PNG, WebP, and DOCX · Max 15MB per file
            </p>
          </div>
        </div>
      </div>

      {/* ─── Global Error ─── */}
      {globalError && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="text-sm font-medium">{globalError}</span>
        </div>
      )}

      {/* ─── Upload Queue ─── */}
      {queuedFiles.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-800">Upload Progress</h3>
          {queuedFiles.map((qf, i) => {
            const catInfo = DOCUMENT_CATEGORIES.find((c) => c.value === qf.documentType);
            return (
              <div
                key={`${qf.file.name}-${i}`}
                className={`
                  relative overflow-hidden rounded-xl border p-4 transition-all duration-300
                  ${qf.status === "success"
                    ? "border-emerald-200 bg-emerald-50/50"
                    : qf.status === "error"
                    ? "border-red-200 bg-red-50/50"
                    : "border-gray-200 bg-white"
                  }
                `}
              >
                {/* Progress bar background */}
                {qf.status === "uploading" && (
                  <div
                    className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300 rounded-full"
                    style={{ width: `${qf.progress}%` }}
                  />
                )}

                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">{catInfo?.icon || <FileIcon size={16} />}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate text-sm">{qf.file.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500">
                        {formatFileSize(qf.file.size)}
                      </span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-500">{catInfo?.label}</span>
                    </div>
                    {qf.status === "error" && (
                      <p className="text-xs text-red-600 mt-1 font-medium">{qf.error}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {qf.status === "uploading" && (
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-xs font-medium text-blue-600">
                          {Math.round(qf.progress)}%
                        </span>
                      </div>
                    )}
                    {qf.status === "success" && (
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                    {qf.status === "error" && (
                      <button
                        type="button"
                        onClick={() => {
                          removeFromQueue(i);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Uploaded Documents ─── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            Uploaded Documents
            {uploadedDocs.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({uploadedDocs.length})
              </span>
            )}
          </h3>
        </div>

        {isLoadingDocs ? (
          <div className="flex items-center justify-center py-12">
            <svg className="w-6 h-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="ml-3 text-gray-500">Loading documents...</span>
          </div>
        ) : uploadedDocs.length === 0 ? (
          <div className="text-center py-12 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
              <ClipboardIcon size={24} className="text-gray-400" />
            </div>
            <p className="text-gray-500 font-medium">No documents uploaded yet</p>
            <p className="text-sm text-gray-400 mt-1">
              Select a category above and upload your first document
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {uploadedDocs.map((doc) => {
              const catInfo = DOCUMENT_CATEGORIES.find((c) => c.value === doc.documentType);
              const reviewBadge = getReviewBadge(doc.reviewStatus);

              return (
                <div
                  key={doc.id}
                  className="group relative rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md hover:border-gray-300 transition-all duration-200"
                >
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                      <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-gray-100 group-hover:bg-blue-50 flex items-center justify-center transition-colors duration-200 text-gray-600">
                        {catInfo?.icon || <FileIcon size={18} />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate text-sm">
                        {doc.fileName}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                        <span className="text-xs text-gray-500">
                          {formatFileSize(doc.fileSize)}
                        </span>
                        <span className="text-gray-300">·</span>
                        <span className="text-xs text-gray-500">
                          {catInfo?.label || doc.documentType}
                        </span>
                        <span className="text-gray-300">·</span>
                        <span className="text-xs text-gray-400">
                          {new Date(doc.createdAt).toLocaleDateString("en-CA", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Status badges */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {/* Virus scan */}
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(doc.virusScanStatus)}`}
                      >
                        {doc.virusScanStatus === "pending"
                          ? "Scanning"
                          : doc.virusScanStatus === "clean"
                          ? "Clean"
                          : "Flagged"}
                      </span>

                      {/* Review status */}
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${reviewBadge.classes}`}
                      >
                        {reviewBadge.text}
                      </span>

                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        disabled={deletingId === doc.id}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all duration-200 disabled:opacity-50"
                        title="Delete document"
                      >
                        {deletingId === doc.id ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Requirements checklist ─── */}
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <ClipboardIcon size={18} className="text-gray-500" /> Requirements Checklist
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {DOCUMENT_CATEGORIES.filter((c) => c.required).map((cat) => {
            const isUploaded = !!completedByType[cat.value];
            return (
              <div
                key={cat.value}
                className={`
                  flex items-center gap-3 p-3 rounded-lg border transition-all duration-200
                  ${isUploaded
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-gray-200 bg-white"
                  }
                `}
              >
                <span
                  className={`
                    flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                    ${isUploaded ? "bg-emerald-500 text-white" : "bg-gray-200 text-gray-500"}
                  `}
                >
                  {isUploaded ? "✓" : "·"}
                </span>
                <div>
                  <span
                    className={`text-sm font-medium ${
                      isUploaded ? "text-emerald-700" : "text-gray-700"
                    }`}
                  >
                    {cat.icon} {cat.label}
                  </span>
                  {isUploaded && (
                    <p className="text-xs text-emerald-600">
                      {completedByType[cat.value]} file(s) uploaded
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hidden file input for programmatic use */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
      />
    </div>
  );
}
