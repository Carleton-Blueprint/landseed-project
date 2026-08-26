import { Prisma, ProjectStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import {
  attachGrantMatchSummaryToBuilderTrendTransfer,
  triggerBuilderTrendTransferForApprovedProject,
} from "@/backend/integrations/buildertrend";

const ALLOWED_TRANSITIONS: Partial<Record<ProjectStatus, ProjectStatus[]>> = {
  ESTIMATE_ACCEPTED: ["APPROVED", "REJECTED"],
};

type ProjectStatusTransitionErrorCode =
  | "PROJECT_NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_TRANSITION"
  | "NO_OP_TRANSITION"
  | "INVALID_REASON";

export class ProjectStatusTransitionError extends Error {
  statusCode: number;
  code: ProjectStatusTransitionErrorCode;

  constructor(message: string, statusCode: number, code: ProjectStatusTransitionErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ProjectStatusTransitionInput {
  projectId: string;
  actorUserId: string;
  toStatus: ProjectStatus;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
  /** Resolved by the caller (route handler already has the session) via
   * hasMinimumRole(session, "ADMIN"). Approving/rejecting a project is an
   * admin-only decision: a client's invited EDITOR (see ProjectAccess) must
   * not be able to approve or reject their own project. */
  isAdmin?: boolean;
}

export interface ProjectStatusTransitionResult {
  projectId: string;
  fromStatus: ProjectStatus;
  toStatus: ProjectStatus;
  changedAt: Date;
  changedByUserId: string;
  historyId: string;
}

export function isValidProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && Object.values(ProjectStatus).includes(value as ProjectStatus);
}

export async function transitionProjectStatus(
  input: ProjectStatusTransitionInput
): Promise<ProjectStatusTransitionResult> {
  if (input.isAdmin !== true) {
    throw new ProjectStatusTransitionError(
      "Forbidden: Only an administrator can approve or reject a project",
      403,
      "FORBIDDEN"
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      status: true,
    },
  });

  if (!project) {
    throw new ProjectStatusTransitionError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const fromStatus = project.status;
  if (fromStatus === input.toStatus) {
    throw new ProjectStatusTransitionError(
      "No-op transition is not allowed",
      400,
      "NO_OP_TRANSITION"
    );
  }

  const nextStatuses = ALLOWED_TRANSITIONS[fromStatus] ?? [];
  if (!nextStatuses.includes(input.toStatus)) {
    throw new ProjectStatusTransitionError(
      `Invalid transition from ${fromStatus} to ${input.toStatus}`,
      422,
      "INVALID_TRANSITION"
    );
  }

  const normalizedReason = input.reason?.trim() ?? null;
  if (input.toStatus === "REJECTED" && !normalizedReason) {
    throw new ProjectStatusTransitionError(
      "A reason is required when transitioning to REJECTED",
      400,
      "INVALID_REASON"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: input.projectId },
      data: {
        status: input.toStatus,
      },
    });

    const historyEntry = await tx.projectStatusHistory.create({
      data: {
        projectId: input.projectId,
        fromStatus,
        toStatus: input.toStatus,
        changedByUserId: input.actorUserId,
        reason: normalizedReason,
        metadata: input.metadata,
      },
      select: {
        id: true,
        changedAt: true,
      },
    });

    return {
      projectId: input.projectId,
      fromStatus,
      toStatus: input.toStatus,
      changedAt: historyEntry.changedAt,
      changedByUserId: input.actorUserId,
      historyId: historyEntry.id,
    };
  });

  // Approval is the BuilderTrend transfer's send gate: a transfer row is
  // created at quote acceptance but held (never enqueued) until this fires. Also
  // pre-warms the Grant Match Summary PDF so it's already READY by send time (see
  // attachGrantMatchSummaryToBuilderTrendTransfer for why "no transfer yet" is
  // expected and not an error there). Fire-and-forget: both are best-effort
  // side effects, not part of the approval transaction itself.
  if (input.toStatus === "APPROVED") {
    attachGrantMatchSummaryToBuilderTrendTransfer(input.projectId, input.actorUserId).catch((err) => {
      console.warn("Failed to attach grant match summary to BuilderTrend transfer for project", input.projectId, err);
    });
    triggerBuilderTrendTransferForApprovedProject(input.projectId, input.actorUserId).catch((err) => {
      console.warn("Failed to trigger BuilderTrend transfer after project approval for project", input.projectId, err);
    });
  }

  return result;
}
