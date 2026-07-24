"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { 
  FileText, 
  Image as ImageIcon, 
  UploadCloud, 
  Trash2, 
  AlertCircle, 
  CheckCircle2, 
  ShieldCheck, 
  Loader2, 
  Search 
} from "lucide-react";

export interface UploadedFloorPlanDoc {
  id: string;
  fileName: string;
  fileSize: number;
  documentType: string;
  virusScanStatus: string;
  reviewStatus?: string;
  createdAt: string;
  s3Url?: string;
}

export interface FloorPlanUploadInterfaceProps {
  projectId: string | null;
  ensureProjectId: () => Promise<string | null>;
}

const MAX_SIZE_MB = 15;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const ACCEPTED_TYPES = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

export function FloorPlanUploadInterface({
  projectId,
  ensureProjectId,
}: FloorPlanUploadInterfaceProps) {
  const [documents, setDocuments] = useState<UploadedFloorPlanDoc[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setDocuments([]);
      return;
    }

    let cancelled = false;
    async function fetchDocs() {
      setIsLoadingDocs(true);
      try {
        const res = await fetch(`/api/documents/list/${projectId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          const floorPlans = (data.documents || []).filter(
            (doc: Record<string, unknown>) =>
              doc.label === "Floor Plan / Layout Sketch" ||
              doc.documentType === "OTHER"
          );
          setDocuments(floorPlans as UploadedFloorPlanDoc[]);
        }
      } catch (err) {
        console.error("Failed to fetch floor plans:", err);
      } finally {
        if (!cancelled) {
          setIsLoadingDocs(false);
        }
      }
    }

    void fetchDocs();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleUpload = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    setIsUploading(true);
    setUploadProgress(10);

    try {
      const pid = await ensureProjectId();
      if (!pid) {
        setError("Could not initialize upload session. Please try again.");
        setIsUploading(false);
        return;
      }

      for (const file of files) {
        if (file.size > MAX_SIZE_BYTES) {
          setError(`"${file.name}" exceeds the maximum limit of 15MB. Please upload a smaller file.`);
          continue;
        }

        const validExts = [".pdf", ".jpg", ".jpeg", ".png"];
        const lowerName = file.name.toLowerCase();
        const hasValidExt = validExts.some((ext) => lowerName.endsWith(ext));
        const hasValidMime = ["application/pdf", "image/jpeg", "image/png"].includes(file.type);

        if (!hasValidExt && !hasValidMime) {
          setError(`"${file.name}" is an invalid format. Only PDF, JPG, and PNG files are accepted.`);
          continue;
        }

        setUploadProgress(30);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("projectId", pid);
        formData.append("documentType", "OTHER");
        formData.append("label", "Floor Plan / Layout Sketch");

        const progressInterval = setInterval(() => {
          setUploadProgress((prev) => (prev ? Math.min(prev + 15, 90) : 50));
        }, 200);

        try {
          const res = await fetch("/api/documents/upload", {
            method: "POST",
            body: formData,
          });

          clearInterval(progressInterval);
          setUploadProgress(100);

          if (res.ok) {
            const data = await res.json();
            if (data.document) {
              setDocuments((prev) => [data.document, ...prev]);
            }
          } else {
            const errData = await res.json().catch(() => null);
            setError(
              errData?.error || `Failed to upload "${file.name}". Please try again.`
            );
          }
        } catch {
          clearInterval(progressInterval);
          setError(`Network error uploading "${file.name}". Please try again.`);
        }
      }
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  }, [ensureProjectId]);

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setError(null);

      if (fileRejections.length > 0) {
        const rejection = fileRejections[0];
        const file = rejection.file;
        const errorCode = rejection.errors[0]?.code;

        if (errorCode === "file-too-large") {
          setError(`"${file.name}" exceeds the maximum limit of 15MB. Please upload a smaller file.`);
        } else if (errorCode === "file-invalid-type") {
          setError(`"${file.name}" has an invalid file type. Please upload a PDF, JPG, or PNG file.`);
        } else {
          setError(rejection.errors[0]?.message || "File upload rejected.");
        }
        return;
      }

      void handleUpload(acceptedFiles);
    },
    [handleUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_SIZE_BYTES,
    disabled: isUploading,
  });

  const handleRemove = async (docId: string) => {
    setRemovingId(docId);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== docId));
      } else {
        setError("Failed to remove document. Please try again.");
      }
    } catch {
      setError("Network error while removing document.");
    } finally {
      setRemovingId(null);
    }
  };

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`relative rounded-2xl border-2 border-dashed p-6 text-center transition-all cursor-pointer ${
          isDragActive
            ? "border-emerald-500 bg-emerald-50/70 shadow-md"
            : "border-gray-300 bg-gray-50/50 hover:border-emerald-400 hover:bg-emerald-50/30"
        } ${isUploading ? "pointer-events-none opacity-70" : ""}`}
      >
        <input {...getInputProps()} />
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-3 shadow-2xs">
          {isUploading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <UploadCloud className="h-6 w-6" />
          )}
        </div>

        <p className="text-sm font-semibold text-gray-800">
          {isDragActive
            ? "Drop floor plans or layout sketches here..."
            : "Click or drag & drop to upload floor plans (Optional)"}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Accepted formats: <strong className="text-gray-700">PDF, JPG, PNG</strong> — Maximum file size: <strong className="text-gray-700">15MB</strong>
        </p>

        {isUploading && (
          <div className="mt-4 max-w-xs mx-auto">
            <div className="flex justify-between text-xs font-semibold text-emerald-800 mb-1">
              <span>Uploading & scanning...</span>
              <span>{uploadProgress || 0}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-emerald-100 overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all duration-300"
                style={{ width: `${uploadProgress || 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs sm:text-sm text-red-700 animate-in fade-in duration-200">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {isLoadingDocs ? (
        <div className="flex items-center justify-center gap-2 py-4 text-xs font-medium text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
          <span>Loading saved floor plans...</span>
        </div>
      ) : (
        documents.length > 0 && (
          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>Uploaded Layouts & Floor Plans ({documents.length})</span>
            </h3>

            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {documents.map((doc) => {
                const isPdf = doc.fileName.toLowerCase().endsWith(".pdf") || doc.documentType === "application/pdf";
                const isPendingScan = doc.virusScanStatus === "pending";
                const isInfected = doc.virusScanStatus === "infected";

                return (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-2xs transition-all hover:shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-bold text-white shadow-xs ${
                          isPdf ? "bg-red-500" : "bg-blue-600"
                        }`}
                      >
                        {isPdf ? <FileText className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900" title={doc.fileName}>
                          {doc.fileName}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-gray-500">
                          <span>{formatSize(doc.fileSize)}</span>
                          <span>•</span>
                          {isPendingScan ? (
                            <span className="inline-flex items-center gap-1 font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/80">
                              <Search className="h-3 w-3 animate-pulse" />
                              <span>Malware Scan Pending</span>
                            </span>
                          ) : isInfected ? (
                            <span className="inline-flex items-center gap-1 font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                              <AlertCircle className="h-3 w-3" />
                              <span>Security Alert</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/80">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              <span>Scan Clean</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleRemove(doc.id)}
                      disabled={removingId === doc.id}
                      className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
                      aria-label={`Remove ${doc.fileName}`}
                      title="Remove document"
                    >
                      {removingId === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
