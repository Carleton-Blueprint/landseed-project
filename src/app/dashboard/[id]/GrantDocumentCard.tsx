"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";

export interface GrantDocumentCardProps {
  projectId: string;
  hasDocument: boolean;
  lastGeneratedAt: string | null;
  incompleteFields: string[];
}

export function GrantDocumentCard({
  projectId,
  hasDocument,
  lastGeneratedAt,
  incompleteFields,
}: GrantDocumentCardProps) {
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      const response = await fetch(`/api/project/${projectId}/grant-document/regenerate`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to regenerate grant document");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate grant document");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-3">
        <svg className="h-5 w-5 text-rose-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        Grant Assessment Document
      </h2>

      {hasDocument ? (
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <p className="text-sm text-gray-600">
              Your personalized grant assessment PDF is ready for download.
            </p>
            {lastGeneratedAt && (
              <p className="mt-1 text-xs text-gray-400">
                Last generated {new Date(lastGeneratedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            )}
          </div>
          <Link href={`/api/documents/${projectId}/download`}>
            <Button variant="default" className="gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download PDF
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
          <p className="text-sm text-gray-500">
            Grant PDF is not yet available. It will appear here if your project is determined eligible.
          </p>
        </div>
      )}

      {incompleteFields.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">
            The following fields were incomplete when this document was generated and may need follow-up:
          </p>
          <p className="mt-1 text-xs text-amber-700">{incompleteFields.join(", ")}</p>
        </div>
      )}

      {hasDocument && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="text-xs font-medium text-gray-500 underline decoration-dotted hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {regenerating ? "Regenerating…" : "Regenerate PDF"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
    </div>
  );
}
