"use client";

import { Button } from "@/frontend/components/ui/button";

type LeaveConfirmModalProps = {
  open: boolean;
  isSaving: boolean;
  onStay: () => void;
  onSaveAndLeave: () => void;
};

export function LeaveConfirmModal({
  open,
  isSaving,
  onStay,
  onSaveAndLeave,
}: LeaveConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onStay}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-confirm-title"
        aria-describedby="leave-confirm-description"
        className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="leave-confirm-title" className="text-lg font-semibold">
          Save your progress?
        </h2>
        <p id="leave-confirm-description" className="mt-2 text-sm text-muted-foreground">
          You have unsaved changes. Save your draft before leaving this page.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onStay} disabled={isSaving}>
            Stay on page
          </Button>
          <Button type="button" onClick={onSaveAndLeave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save and leave"}
          </Button>
        </div>
      </div>
    </div>
  );
}
