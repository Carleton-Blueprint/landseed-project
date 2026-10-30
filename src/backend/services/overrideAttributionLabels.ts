/**
 * Admin-facing wording for override attribution. Pure (no Prisma), so the
 * admin dashboard's client component can import it and format dates in the
 * viewer's locale. Data comes from overrideAttribution.ts.
 *
 * Client surfaces never use these labels — they show only
 * CLIENT_OVERRIDE_LABEL, with no names or override type.
 */

export const CLIENT_OVERRIDE_LABEL = "Overridden by LandSeed staff";

/** Account deletion nulls name/email but keeps the User row. */
export const FORMER_STAFF_LABEL = "a former staff member";

export type AdminEligibilityAction = "PRE_ESTIMATE_OVERRIDE" | "REASSESS" | "MANUAL_GRANTS";

export interface AdminAssessmentAttribution {
  adminAction: AdminEligibilityAction;
  adminName: string;
  /** ISO timestamp of the assessment. */
  at: string;
  /** Assessment createdAt vs the project's first quote's createdAt. */
  stage: "pre-estimate" | "post-estimate";
}

export interface PostEstimateOverrideEntry {
  adminName: string;
  /** ISO timestamp. */
  at: string;
}

export interface PostEstimateOverrideAttribution extends PostEstimateOverrideEntry {
  /** Number of times this quote was overridden (from the audit log; at least 1). */
  editCount: number;
  /** Every override from the audit log, newest first. Empty if none were logged. */
  history: PostEstimateOverrideEntry[];
}

export interface OverrideAttribution {
  /** Latest assessment's attribution, only when an admin produced it. */
  assessment: AdminAssessmentAttribution | null;
  postEstimateOverride: PostEstimateOverrideAttribution | null;
  /** Clients see CLIENT_OVERRIDE_LABEL only for a post-estimate QuoteOverride. */
  clientOverridden: boolean;
}

export function displayStaffName(user: { name: string | null; email: string | null } | null): string {
  return user?.name?.trim() || user?.email?.trim() || FORMER_STAFF_LABEL;
}

export function formatAssessmentAttribution(
  attribution: AdminAssessmentAttribution,
  formatDate: (iso: string) => string
): string {
  const by = `by ${attribution.adminName} on ${formatDate(attribution.at)}`;
  switch (attribution.adminAction) {
    case "PRE_ESTIMATE_OVERRIDE":
      return `Pre-estimate override ${by}`;
    case "MANUAL_GRANTS":
      return `Manual grants entered ${by}`;
    case "REASSESS":
      return `Re-assessed ${by} (${attribution.stage})`;
  }
}

export function formatPostEstimateOverride(
  attribution: PostEstimateOverrideAttribution,
  formatDate: (iso: string) => string
): string {
  const label = `Post-estimate override by ${attribution.adminName} on ${formatDate(attribution.at)}`;
  return attribution.editCount > 1 ? `${label} (edited ${attribution.editCount} times)` : label;
}
