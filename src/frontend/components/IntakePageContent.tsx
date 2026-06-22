"use client";

import { IntakeDraftProvider } from "@/frontend/contexts/IntakeDraftContext";
import { GuidedIntakeForm } from "@/frontend/components/GuidedIntakeForm";
import { IntakeForm } from "@/frontend/components/IntakeForm";
import { DraftSaveStatus } from "@/frontend/components/DraftSaveStatus";
import { IntakeLeaveGuard } from "@/frontend/components/IntakeLeaveGuard";
import { ResumeDraftBanner } from "@/frontend/components/ResumeDraftBanner";

export function IntakePageContent() {
  return (
    <IntakeDraftProvider>
      <IntakeLeaveGuard />
      <ResumeDraftBanner />
      <div id="guided-intake" className="mb-12">
        <GuidedIntakeForm />
      </div>
      <div id="intake-form">
        <IntakeForm />
      </div>
      <DraftSaveStatus />
    </IntakeDraftProvider>
  );
}
