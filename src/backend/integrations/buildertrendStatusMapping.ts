import { ProjectStatus } from "@prisma/client";

/**
 * Maps BuilderTrend's external work-order status vocabulary to LandSeed's
 * internal Project.status enum. These are the post-approval, work-in-progress
 * states of the single unified ProjectStatus lifecycle (see
 * prisma/schema.prisma) — reached only after a project has been admin-approved
 * and its work order sent to BuilderTrend.
 */

export const BUILDERTREND_STATUS_MAP: Record<string, ProjectStatus> = {
  SCHEDULED: ProjectStatus.WORK_SCHEDULED,
  IN_PROGRESS: ProjectStatus.WORK_IN_PROGRESS,
  ON_HOLD: ProjectStatus.WORK_ON_HOLD,
  COMPLETED: ProjectStatus.WORK_COMPLETED,
  CANCELLED: ProjectStatus.WORK_CANCELLED,
};

export function mapBuilderTrendStatus(externalStatus: string): ProjectStatus | null {
  return BUILDERTREND_STATUS_MAP[externalStatus.toUpperCase()] ?? null;
}
