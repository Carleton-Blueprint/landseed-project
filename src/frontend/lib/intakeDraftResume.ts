import type { GuidedData } from "@/backend/schemas/intakeDraft";

export function isGuidedSectionComplete(data: GuidedData | null | undefined): boolean {
  if (!data) return false;
  return !!(
    data.mobilityAssistance &&
    data.safetyFeatures &&
    data.safetyFeatures.length > 0 &&
    data.bathroomModifications &&
    data.urgency
  );
}

export function getResumeScrollTargetId(
  guidedData: GuidedData | null | undefined
): "guided-intake" | "intake-form" {
  return isGuidedSectionComplete(guidedData) ? "intake-form" : "guided-intake";
}
