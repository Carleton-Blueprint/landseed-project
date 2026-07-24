"use client";

import React, { useCallback, useImperativeHandle, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

export interface PhotoUploadInterfaceProps {
  onUpload?: (files: File[]) => void;
  onDeleteFile?: (file: File, index: number) => void;
  maxFiles?: number;
  maxSizeMB?: number;
}

export interface PhotoUploadInterfaceHandle {
  removeFile: (file: File) => void;
}

const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic"];
const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];

function isAcceptedFileType(file: File) {
  const fileName = file.name.toLowerCase();
  return (
    ACCEPTED_MIME_TYPES.includes(file.type) ||
    ACCEPTED_EXTENSIONS.some((ext) => fileName.endsWith(ext))
  );
}

export const PhotoUploadInterface = React.forwardRef<
  PhotoUploadInterfaceHandle,
  PhotoUploadInterfaceProps
>(function PhotoUploadInterface(
  { onUpload, onDeleteFile, maxFiles = 10, maxSizeMB = 10 },
  ref
) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const simulateProgress = (file: File) => {
    const fileKey = `${file.name}-${file.size}`;
    setUploadProgress((prev) => ({ ...prev, [fileKey]: 0 }));

    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 30 + 10;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
      }
      setUploadProgress((prev) => ({
        ...prev,
        [fileKey]: Math.min(progress, 100),
      }));
    }, 250);
  };

  const handleReplaceClick = (index: number) => {
    setReplaceIndex(index);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleReplaceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || replaceIndex === null) return;

    const newFile = e.target.files[0];

    if (!isAcceptedFileType(newFile)) {
      setError("Only JPG, JPEG, PNG, and HEIC files are allowed.");
      return;
    }

    if (newFile.size > maxSizeMB * 1024 * 1024) {
      setError(`File is too large. Max size is ${maxSizeMB}MB.`);
      return;
    }

    const updatedFiles = [...files];
    updatedFiles[replaceIndex] = newFile;
    setFiles(updatedFiles);
    simulateProgress(newFile);

    if (onUpload) {
      onUpload(updatedFiles);
    }

    setReplaceIndex(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setError(null);
  };

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: import("react-dropzone").FileRejection[]) => {
      setError(null);

      if (fileRejections.length > 0) {
        const rejection = fileRejections[0];
        const firstError = rejection.errors[0];

        if (firstError?.code === "file-too-large") {
          setError(`File is too large. Max size is ${maxSizeMB}MB.`);
        } else if (firstError?.code === "too-many-files") {
          setError(`You can only upload up to ${maxFiles} files.`);
        } else if (firstError?.code === "file-invalid-type") {
          setError("Only JPG, JPEG, PNG, and HEIC files are allowed.");
        } else {
          setError(firstError?.message || "Invalid file.");
        }
        return;
      }

      if (files.length + acceptedFiles.length > maxFiles) {
        setError(`You can only upload up to ${maxFiles} files total.`);
        return;
      }

      const invalidFile = acceptedFiles.find((file) => !isAcceptedFileType(file));
      if (invalidFile) {
        setError("Only JPG, JPEG, PNG, and HEIC files are allowed.");
        return;
      }

      const updatedFiles = [...files, ...acceptedFiles];
      setFiles(updatedFiles);

      acceptedFiles.forEach(simulateProgress);

      if (onUpload) {
        onUpload(updatedFiles);
      }
    },
    [files, maxFiles, maxSizeMB, onUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/heic": [".heic"],
      "image/heif": [".heic"],
    },
    maxSize: maxSizeMB * 1024 * 1024,
    maxFiles,
  });

  const removeFile = (index: number) => {
    const removedFile = files[index];
    const filteredFiles = files.filter((_, i) => i !== index);
    setFiles(filteredFiles);
    if (onUpload) {
      onUpload(filteredFiles);
    }
    onDeleteFile?.(removedFile, index);
    setError(null);
  };

  useImperativeHandle(
    ref,
    () => ({
      removeFile: (file: File) => {
        setFiles((prev) => prev.filter((f) => f !== file));
      },
    }),
    []
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
            {isDragActive ? "Drop here..." : "Click or drag files here to upload"}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Accepted formats: JPG, JPEG, PNG, HEIC
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Max {maxFiles} files (up to {maxSizeMB}MB each)
          </p>
        </div>
      </div>

      {error && <div className="text-sm font-semibold text-red-500">{error}</div>}

      {files.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-semibold">Uploaded Files ({files.length})</p>
          <ul className="space-y-2">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${file.size}-${i}`}
                className="flex items-center justify-between rounded border bg-white p-2 shadow-sm"
              >
                <div className="mr-4 flex flex-1 flex-col">
                  <span className="text-sm font-medium">{file.name}</span>
                  <span className="mb-2 text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </span>

                  <div className="h-2 w-full rounded-full bg-gray-200">
                    <div
                      className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${uploadProgress[`${file.name}-${file.size}`] ?? 100}%` }}
                    />
                  </div>

                  {(uploadProgress[`${file.name}-${file.size}`] ?? 100) < 100 ? (
                    <span className="mt-1 text-xs text-gray-500">
                      Uploading...{" "}
                      {Math.round(uploadProgress[`${file.name}-${file.size}`] ?? 0)}%
                    </span>
                  ) : (
                    <span className="mt-1 text-xs font-semibold text-green-600">Ready</span>
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
                      removeFile(i);
                    }}
                    className="rounded p-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".jpg,.jpeg,.png,.heic,image/jpeg,image/png,image/heic,image/heif"
            onChange={handleReplaceFile}
          />
        </div>
      )}
    </div>
  );
});