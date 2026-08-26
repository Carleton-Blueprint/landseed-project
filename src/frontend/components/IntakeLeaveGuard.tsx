"use client";

import { useIntakeDraft } from "@/frontend/contexts/IntakeDraftContext";
import { useIntakeLeaveGuard } from "@/frontend/hooks/useIntakeLeaveGuard";
import { LeaveConfirmModal } from "@/frontend/components/LeaveConfirmModal";

export function IntakeLeaveGuard() {
  const { isDirty, isSaving, isSubmitting, saveNow, flushBeaconSave } = useIntakeDraft();
  const { isModalOpen, isLeaving, handleStay, handleSaveAndLeave } = useIntakeLeaveGuard({
    // Once Submit is clicked, the form is already saving and promoting the
    // draft on its own — the leave-guard must not interrupt that with a
    // "changes not saved" prompt (native or in-app) while it finishes.
    enabled: (isDirty || isSaving) && !isSubmitting,
    isSaving,
    saveNow,
    flushBeaconSave,
  });

  return (
    <LeaveConfirmModal
      open={isModalOpen}
      isSaving={isLeaving}
      onStay={handleStay}
      onSaveAndLeave={handleSaveAndLeave}
    />
  );
}
