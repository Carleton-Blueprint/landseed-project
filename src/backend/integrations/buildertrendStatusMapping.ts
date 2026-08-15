/**
 * Maps BuilderTrend's external work-order status vocabulary to LandSeed's
 * internal Project.status strings. Project.status is a free-form string
 * (see prisma/schema.prisma), not an enum, so this mapping just extends that
 * existing convention with a "work_*" vocabulary for the post-transfer,
 * work-in-progress phase of a project's lifecycle.
 */

export const BUILDERTREND_STATUS_MAP: Record<string, string> = {
  SCHEDULED: "work_scheduled",
  IN_PROGRESS: "work_in_progress",
  ON_HOLD: "work_on_hold",
  COMPLETED: "work_completed",
  CANCELLED: "work_cancelled",
};

export function mapBuilderTrendStatus(externalStatus: string): string | null {
  return BUILDERTREND_STATUS_MAP[externalStatus.toUpperCase()] ?? null;
}
