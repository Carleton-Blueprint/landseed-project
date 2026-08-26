"use client";

import React, { useCallback, useImperativeHandle, useState } from "react";
import { useDropzone } from "react-dropzone";

export interface PhotoUploadInterfaceProps {
  onUpload?: (files: File[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
  disabled?: boolean;
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
  { onUpload, maxFiles = 10, maxSizeMB = 10, disabled = false },
  ref
) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

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

      if (acceptedFiles.length > maxFiles) {
        setError(`You can only upload up to ${maxFiles} more file${maxFiles === 1 ? "" : "s"}.`);
        return;
      }

      const invalidFile = acceptedFiles.find((file) => !isAcceptedFileType(file));
      if (invalidFile) {
        setError("Only JPG, JPEG, PNG, and HEIC files are allowed.");
        return;
      }

      const updatedFiles = [...files, ...acceptedFiles];
      setFiles(updatedFiles);

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
    disabled,
  });

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
        title={
          disabled
            ? "You've reached the max of 10 photos — delete a photo to upload more."
            : undefined
        }
        className={`rounded border-2 border-dashed p-8 text-center ${
          disabled
            ? "cursor-not-allowed border-gray-200 opacity-60"
            : isDragActive
              ? "cursor-pointer border-blue-500 bg-blue-50"
              : "cursor-pointer border-gray-300 hover:border-blue-400"
        }`}
      >
        <input {...getInputProps()} />
        <div>
          <p className="font-semibold text-gray-700">
            {disabled
              ? "Maximum of 10 photos reached"
              : isDragActive
                ? "Drop here..."
                : "Click or drag files here to upload"}
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
    </div>
  );
});