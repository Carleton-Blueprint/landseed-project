"use client";

import { useIntakeDraft } from "@/frontend/contexts/IntakeDraftContext";
import { useIntakeLeaveGuard } from "@/frontend/hooks/useIntakeLeaveGuard";
import { LeaveConfirmModal } from "@/frontend/components/LeaveConfirmModal";

export function IntakeLeaveGuard() {
  const { isDirty, isSaving, saveNow, flushBeaconSave } = useIntakeDraft();
  const { isModalOpen, isLeaving, handleStay, handleSaveAndLeave } = useIntakeLeaveGuard({
    enabled: isDirty || isSaving,
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
