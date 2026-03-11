"use client";

import React, { useCallback, useState, useRef } from "react";
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
            setUploadProgress((prev) => ({ ...prev, [fileKey]: Math.min(progress, 100) }));
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

        // validate size
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

        // reset
        setReplaceIndex(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
        setError(null);
    };

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
                                <div className="flex flex-col flex-1 mr-4">
                                    <span className="text-sm font-medium">{file.name}</span>
                                    <span className="text-xs text-gray-500 mb-2">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                    </span>
                                    <div className="w-full bg-gray-200 rounded-full h-2">
                                        <div
                                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                            style={{ width: `${uploadProgress[`${file.name}-${file.size}`] ?? 100}%` }}
                                        ></div>
                                    </div>
                                    {(uploadProgress[`${file.name}-${file.size}`] ?? 100) < 100 ? (
                                        <span className="text-xs text-gray-500 mt-1">
                                            Uploading... {Math.round(uploadProgress[`${file.name}-${file.size}`] ?? 0)}%
                                        </span>
                                    ) : (
                                        <span className="text-xs text-green-600 mt-1 font-semibold">Ready</span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleReplaceClick(i);
                                        }}
                                        className="text-blue-500 hover:bg-blue-50 p-2 text-sm rounded font-medium transition-colors"
                                    >
                                        Replace
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeFile(i);
                                        }}
                                        className="text-red-500 hover:bg-red-50 p-2 text-sm rounded font-medium transition-colors"
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
                        accept="image/jpeg, image/jpg, image/png, image/webp"
                        onChange={handleReplaceFile}
                    />
                </div>
            )}
        </div>
    );
}
