"use client";

import { IntakeDraftProvider } from "@/frontend/contexts/IntakeDraftContext";
import { GuidedIntakeForm } from "@/frontend/components/GuidedIntakeForm";
import { IntakeForm } from "@/frontend/components/IntakeForm";
import { DraftSaveStatus } from "@/frontend/components/DraftSaveStatus";

export function IntakePageContent() {
  return (
    <IntakeDraftProvider>
      <div className="mb-12">
        <GuidedIntakeForm />
      </div>
      <IntakeForm />
      <DraftSaveStatus />
    </IntakeDraftProvider>
  );
}
