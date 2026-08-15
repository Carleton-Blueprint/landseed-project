"use client";

import { useIntakeDraft } from "@/frontend/contexts/IntakeDraftContext";
import { CheckCircle2, CloudAlert, RefreshCw, Cloud } from "lucide-react";

export function DraftSaveStatus() {
  const { isSaving, lastSaved, saveError } = useIntakeDraft();

  if (saveError) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100/80 text-red-700 text-xs font-semibold shadow-2xs" role="alert">
        <CloudAlert className="h-3.5 w-3.5 shrink-0 text-red-600" />
        <span>{saveError}</span>
      </div>
    );
  }

  if (isSaving) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100/80 text-emerald-800 text-xs font-semibold animate-pulse shadow-2xs" role="status">
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-600" />
        <span>Saving changes...</span>
      </div>
    );
  }

  if (lastSaved) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100/80 text-emerald-800 text-xs font-semibold shadow-2xs" role="status">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span>Saved at {lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100/60 text-emerald-800 text-xs font-medium shadow-2xs" role="status">
      <Cloud className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
      <span>Auto-save active</span>
    </div>
  );
}
