"use client";

import React, { useCallback, useState, useRef } from "react";
import { useDropzone } from "react-dropzone";

export interface PhotoUploadInterfaceProps {
    onUpload?: (files: File[]) => void;
    maxFiles?: number;
    maxSizeMB?: number;
}

interface TrackedFile {
    file: File;
    progress: number;
}

export function PhotoUploadInterface({
    onUpload,
    maxFiles = 10,
    maxSizeMB = 10,
}: PhotoUploadInterfaceProps) {
    const [files, setFiles] = useState<TrackedFile[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
    const hiddenInputRef = useRef<HTMLInputElement>(null);

    const notifyParent = useCallback((currentFiles: TrackedFile[]) => {
        if (onUpload) {
            onUpload(currentFiles.map(f => f.file));
        }
    }, [onUpload]);

    const handleReplaceClick = (index: number) => {
        setReplaceIndex(index);
        if (hiddenInputRef.current) {
            hiddenInputRef.current.click();
        }
    };

    const simulateProgress = useCallback((indexToAnimate: number | number[]) => {
        const indices = Array.isArray(indexToAnimate) ? indexToAnimate : [indexToAnimate];
        let currentProgress = 0;
        const interval = setInterval(() => {
            currentProgress += 10;
            if (currentProgress > 100) {
                currentProgress = 100;
                clearInterval(interval);
            }
            setFiles(prev => {
                const next = [...prev];
                let changed = false;
                indices.forEach(idx => {
                    if (next[idx] && next[idx].progress < currentProgress) {
                        next[idx] = { ...next[idx], progress: currentProgress };
                        changed = true;
                    }
                });
                if (changed && currentProgress === 100) {
                    // Update parent once progress is complete
                    setTimeout(() => notifyParent(next), 0);
                }
                return changed ? next : prev;
            });
        }, 50);
    }, [notifyParent]);

    const handleReplaceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0 && replaceIndex !== null) {
            const newFile = e.target.files[0];
            
            if (newFile.size > maxSizeMB * 1024 * 1024) {
                setError("Replacement file is too large. Max size is " + maxSizeMB + "MB.");
                e.target.value = "";
                setReplaceIndex(null);
                return;
            }

            setFiles(prev => {
                const updated = [...prev];
                updated[replaceIndex] = { file: newFile, progress: 0 };
                return updated;
            });
            setError(null);
            
            // Simulate progress for replaced file
            simulateProgress(replaceIndex);
        }
        e.target.value = "";
        setReplaceIndex(null);
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

            const startIndex = files.length;
            const newTrackedFiles = acceptedFiles.map(f => ({ file: f, progress: 0 }));
            
            setFiles(prev => {
                const updated = [...prev, ...newTrackedFiles];
                return updated;
            });

            const indicesToAnimate = newTrackedFiles.map((_, i) => startIndex + i);
            simulateProgress(indicesToAnimate);

        },
        [files, maxFiles, maxSizeMB, notifyParent, simulateProgress]
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
        setFiles(prev => {
            const filtered = prev.filter((_, i) => i !== index);
            notifyParent(filtered);
            return filtered;
        });
    };

    return (
        <div className="w-full space-y-4">
            <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded p-8 text-center cursor-pointer transition-colors ${
                    isDragActive 
                        ? "border-primary bg-primary/10" 
                        : "border-muted-foreground/30 hover:border-primary/50"
                }`}
            >
                <input {...getInputProps()} />
                <div>
                    <p className="font-semibold text-foreground">
                        {isDragActive
                            ? "Drop here..."
                            : "Click or drag files here to upload"}
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                        Max {maxFiles} files (Up to {maxSizeMB}MB each)
                    </p>
                </div>
            </div>

            {error && (
                <div className="text-destructive text-sm font-semibold" role="alert">
                    {error}
                </div>
            )}

            {files.length > 0 && (
                <div className="mt-4">
                    <p className="font-semibold mb-2 text-foreground">Uploaded Files ({files.length})</p>
                    <ul className="space-y-3">
                        {files.map((trackedFile, i) => (
                            <li
                                key={i}
                                className="flex flex-col p-3 border rounded bg-card text-card-foreground shadow-sm gap-2"
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex flex-col truncate pr-4">
                                        <span className="text-sm font-medium truncate">{trackedFile.file.name}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {(trackedFile.file.size / 1024 / 1024).toFixed(2)} MB
                                        </span>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleReplaceClick(i);
                                            }}
                                            className="text-primary hover:bg-primary/10 p-1.5 text-sm rounded transition-colors"
                                            aria-label={`Replace ${trackedFile.file.name}`}
                                            disabled={trackedFile.progress < 100}
                                        >
                                            Replace
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeFile(i);
                                            }}
                                            className="text-destructive hover:bg-destructive/10 p-1.5 text-sm rounded transition-colors"
                                            aria-label={`Delete ${trackedFile.file.name}`}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                                
                                {/* Visual Progress Bar */}
                                <div className="w-full bg-secondary rounded-full h-2.5 overflow-hidden" aria-hidden="true">
                                    <div 
                                        className="bg-primary h-2.5 rounded-full transition-all duration-75 ease-out"
                                        style={{ width: `${trackedFile.progress}%` }}
                                    ></div>
                                </div>
                                {trackedFile.progress < 100 && (
                                    <span className="text-xs text-muted-foreground animate-pulse">
                                        Uploading... {trackedFile.progress}%
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <input 
                type="file" 
                className="hidden" 
                ref={hiddenInputRef} 
                onChange={handleReplaceChange} 
                accept="image/*,.jpeg,.jpg,.png,.webp"
                aria-label="Hidden replacement file input"
            />
        </div>
    );
}

