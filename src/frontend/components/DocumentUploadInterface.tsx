"use client";

import React, { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

export type DocumentCategory =
  | "proof_of_income"
  | "medical_records"
  | "property_ownership"
  | "identification"
  | "other";

export interface UploadedDocument {
  file: File;
  category: DocumentCategory;
  grantApplicationId: string;
}

export interface DocumentUploadInterfaceProps {
  grantApplicationId: string;
  onUpload?: (docs: UploadedDocument[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
  requiredCategories?: DocumentCategory[];
}

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  proof_of_income: "Proof of Income",
  medical_records: "Medical Records",
  property_ownership: "Property Ownership",
  identification: "Identification",
  other: "Other",
};

const ACCEPTED_MIME_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/heic": [".heic"],
  "image/heif": [".heic"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
};

const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".doc",
  ".docx",
];

function isAcceptedFileType(file: File) {
  const name = file.name.toLowerCase();
  return (
    Object.keys(ACCEPTED_MIME_TYPES).includes(file.type) ||
    ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
  );
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

interface PendingDocument {
  file: File;
  category: DocumentCategory;
}

export function DocumentUploadInterface({
  grantApplicationId,
  onUpload,
  maxFiles = 15,
  maxSizeMB = 15,
  requiredCategories,
}: DocumentUploadInterfaceProps) {
  const [docs, setDocs] = useState<PendingDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const emit = (next: PendingDocument[]) => {
    if (!onUpload) return;
    onUpload(
      next.map((d) => ({
        file: d.file,
        category: d.category,
        grantApplicationId,
      }))
    );
  };

  const simulateProgress = (file: File) => {
    const key = fileKey(file);
    setProgress((prev) => ({ ...prev, [key]: 0 }));
    let pct = 0;
    const interval = setInterval(() => {
      pct += Math.random() * 25 + 10;
      if (pct >= 100) {
        pct = 100;
        clearInterval(interval);
      }
      setProgress((prev) => ({ ...prev, [key]: Math.min(pct, 100) }));
    }, 220);
  };

  const onDrop = useCallback(
    (
      accepted: File[],
      rejections: import("react-dropzone").FileRejection[]
    ) => {
      setError(null);

      if (rejections.length > 0) {
        const first = rejections[0].errors[0];
        if (first?.code === "file-too-large") {
          setError(`File is too large. Max size is ${maxSizeMB}MB.`);
        } else if (first?.code === "too-many-files") {
          setError(`You can only upload up to ${maxFiles} files.`);
        } else if (first?.code === "file-invalid-type") {
          setError("Accepted: PDF, JPG, PNG, HEIC, DOC, DOCX.");
        } else {
          setError(first?.message || "Invalid file.");
        }
        return;
      }

      if (docs.length + accepted.length > maxFiles) {
        setError(`You can only upload up to ${maxFiles} files total.`);
        return;
      }

      const invalid = accepted.find((f) => !isAcceptedFileType(f));
      if (invalid) {
        setError("Accepted: PDF, JPG, PNG, HEIC, DOC, DOCX.");
        return;
      }

      const additions: PendingDocument[] = accepted.map((file) => ({
        file,
        category: "other",
      }));
      const next = [...docs, ...additions];
      setDocs(next);
      accepted.forEach(simulateProgress);
      emit(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs, maxFiles, maxSizeMB]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME_TYPES,
    maxSize: maxSizeMB * 1024 * 1024,
    maxFiles,
  });

  const setCategory = (index: number, category: DocumentCategory) => {
    const next = docs.map((d, i) => (i === index ? { ...d, category } : d));
    setDocs(next);
    emit(next);
  };

  const removeDoc = (index: number) => {
    const next = docs.filter((_, i) => i !== index);
    setDocs(next);
    emit(next);
    setError(null);
  };

  const handleReplaceClick = (index: number) => {
    setReplaceIndex(index);
    replaceInputRef.current?.click();
  };

  const handleReplaceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || replaceIndex === null) return;
    const newFile = e.target.files[0];

    if (!isAcceptedFileType(newFile)) {
      setError("Accepted: PDF, JPG, PNG, HEIC, DOC, DOCX.");
      return;
    }
    if (newFile.size > maxSizeMB * 1024 * 1024) {
      setError(`File is too large. Max size is ${maxSizeMB}MB.`);
      return;
    }

    const next = docs.map((d, i) =>
      i === replaceIndex ? { ...d, file: newFile } : d
    );
    setDocs(next);
    simulateProgress(newFile);
    emit(next);
    setReplaceIndex(null);
    if (replaceInputRef.current) replaceInputRef.current.value = "";
    setError(null);
  };

  const missingRequired = (requiredCategories ?? []).filter(
    (req) => !docs.some((d) => d.category === req)
  );

  return (
    <div className="w-full space-y-4">
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded border-2 border-dashed p-8 text-center ${
          isDragActive
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-blue-400"
        }`}
      >
        <input {...getInputProps()} />
        <div>
          <p className="font-semibold text-gray-700">
            {isDragActive
              ? "Drop documents here..."
              : "Click or drag documents here to upload"}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Accepted: PDF, JPG, PNG, HEIC, DOC, DOCX
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Max {maxFiles} files (up to {maxSizeMB}MB each)
          </p>
        </div>
      </div>

      {error && (
        <div className="text-sm font-semibold text-red-500">{error}</div>
      )}

      {missingRequired.length > 0 && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          role="status"
        >
          <p className="font-medium">Still required:</p>
          <ul className="mt-1 list-inside list-disc">
            {missingRequired.map((cat) => (
              <li key={cat}>{CATEGORY_LABELS[cat]}</li>
            ))}
          </ul>
        </div>
      )}

      {docs.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-semibold">
            Uploaded Documents ({docs.length})
          </p>
          <ul className="space-y-2">
            {docs.map((doc, i) => {
              const key = fileKey(doc.file);
              const pct = progress[key] ?? 100;
              return (
                <li
                  key={`${key}-${i}`}
                  className="flex flex-col gap-3 rounded border bg-white p-3 shadow-sm sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="mr-4 flex flex-1 flex-col">
                    <span className="text-sm font-medium break-all">
                      {doc.file.name}
                    </span>
                    <span className="mb-2 text-xs text-gray-500">
                      {(doc.file.size / 1024 / 1024).toFixed(2)} MB
                    </span>

                    <label className="mb-2 flex flex-col gap-1 text-xs text-gray-600">
                      <span>Document type</span>
                      <select
                        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
                        value={doc.category}
                        onChange={(e) =>
                          setCategory(i, e.target.value as DocumentCategory)
                        }
                      >
                        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="h-2 w-full rounded-full bg-gray-200">
                      <div
                        className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {pct < 100 ? (
                      <span className="mt-1 text-xs text-gray-500">
                        Uploading... {Math.round(pct)}%
                      </span>
                    ) : (
                      <span className="mt-1 text-xs font-semibold text-green-600">
                        Ready — linked to application {grantApplicationId}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReplaceClick(i);
                      }}
                      className="rounded p-2 text-sm font-medium text-blue-500 transition-colors hover:bg-blue-50"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeDoc(i);
                      }}
                      className="rounded p-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <input
            type="file"
            ref={replaceInputRef}
            className="hidden"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            onChange={handleReplaceFile}
          />
        </div>
      )}
    </div>
  );
}
