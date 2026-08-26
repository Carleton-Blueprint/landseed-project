"use client";

import { useIntakeDraft } from "@/frontend/contexts/IntakeDraftContext";
import { Button } from "@/frontend/components/ui/button";

export function NewProjectConfirmModal() {
  const { showNewProjectConfirm, restoredAt, confirmStartNew, cancelStartNew } =
    useIntakeDraft();

  if (!showNewProjectConfirm) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={cancelStartNew}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-confirm-title"
        aria-describedby="new-project-confirm-description"
        className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-project-confirm-title" className="text-lg font-semibold">
          Start a new project?
        </h2>
        <p id="new-project-confirm-description" className="mt-2 text-sm text-muted-foreground">
          Discard your in-progress draft
          {restoredAt ? ` from ${restoredAt.toLocaleString()}` : ""} and start over? This
          can&apos;t be undone.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={cancelStartNew}>
            Keep my draft
          </Button>
          <Button type="button" onClick={confirmStartNew}>
            Discard and start new
          </Button>
        </div>
      </div>
    </div>
  );
}
