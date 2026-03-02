"use client";

import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

export interface PhotoUploadInterfaceProps {
    onUpload?: (files: File[]) => void;
    maxFiles?: number;
    maxSizeMB?: number;
}

export function PhotoUploadInterface({
    onUpload,
    maxFiles = 10,
    maxSizeMB = 10,
}: PhotoUploadInterfaceProps) {
    const [files, setFiles] = useState<File[]>([]);
    const [error, setError] = useState<string | null>(null);

    const onDrop = useCallback(
        (acceptedFiles: File[], fileRejections: import("react-dropzone").FileRejection[]) => {
            setError(null);

            // check if there are errors
            if (fileRejections.length > 0) {
                const rej = fileRejections[0];
                if (rej.errors[0]?.code === "file-too-large") {
                    setError("File is too large. Max size is " + maxSizeMB + "MB.");
                } else if (rej.errors[0]?.code === "too-many-files") {
                    setError("You can only upload up to " + maxFiles + " files.");
                } else {
                    setError(rej.errors[0]?.message || "Invalid file.");
                }
                return;
            }

            // make sure we don't go over max files
            if (files.length + acceptedFiles.length > maxFiles) {
                setError("You can only upload up to " + maxFiles + " files total.");
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
            "image/*": [".jpeg", ".jpg", ".png", ".webp"],
        },
        maxSize: maxSizeMB * 1024 * 1024,
        maxFiles,
    });

    const removeFile = (index: number) => {
        const filteredFiles = files.filter((_, i) => i !== index);
        setFiles(filteredFiles);
        if (onUpload) {
            onUpload(filteredFiles);
        }
    };

    return (
        <div className="w-full space-y-4">
            <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded p-8 text-center cursor-pointer ${isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400"
                    }`}
            >
                <input {...getInputProps()} />
                <div>
                    <p className="font-semibold text-gray-700">
                        {isDragActive
                            ? "Drop here..."
                            : "Click or drag files here to upload"}
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                        Max {maxFiles} files (Up to {maxSizeMB}MB each)
                    </p>
                </div>
            </div>

            {error && (
                <div className="text-red-500 text-sm font-semibold">
                    {error}
                </div>
            )}

            {files.length > 0 && (
                <div className="mt-4">
                    <p className="font-semibold mb-2">Uploaded Files ({files.length})</p>
                    <ul className="space-y-2">
                        {files.map((file, i) => (
                            <li
                                key={i}
                                className="flex justify-between items-center p-2 border rounded bg-white shadow-sm"
                            >
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium pr-4">{file.name}</span>
                                    <span className="text-xs text-gray-500">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeFile(i);
                                    }}
                                    className="text-red-500 hover:bg-red-50 p-1 rounded"
                                >
                                    Delete
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
