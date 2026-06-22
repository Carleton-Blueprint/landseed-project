"use client";

import { useIntakeDraft } from "@/frontend/contexts/IntakeDraftContext";

export function DraftSaveStatus() {
  const { isSaving, lastSaved, saveError } = useIntakeDraft();

  if (saveError) {
    return (
      <p className="mt-4 text-sm text-destructive" role="alert">
        {saveError}
      </p>
    );
  }

  if (isSaving) {
    return (
      <p className="mt-4 text-sm text-muted-foreground" role="status">
        Saving…
      </p>
    );
  }

  if (lastSaved) {
    return (
      <p className="mt-4 text-sm text-green-700" role="status">
        All changes saved at {lastSaved.toLocaleString()}
      </p>
    );
  }

  return null;
}
