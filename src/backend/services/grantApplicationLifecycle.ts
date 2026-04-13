import { GrantApplicationStatus, Prisma, ProjectAccessRole } from "@prisma/client";
import { prisma } from "lib/prisma";
import { hasProjectAccess } from "@/backend/auth/projectAccess";

const ALLOWED_TRANSITIONS: Record<GrantApplicationStatus, GrantApplicationStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

type GrantLifecycleTransitionErrorCode =
  | "PROJECT_NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_TRANSITION"
  | "NO_OP_TRANSITION"
  | "INVALID_REASON";

export class GrantLifecycleTransitionError extends Error {
  statusCode: number;
  code: GrantLifecycleTransitionErrorCode;

  constructor(message: string, statusCode: number, code: GrantLifecycleTransitionErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface GrantLifecycleTransitionInput {
  projectId: string;
  actorUserId: string;
  toStatus: GrantApplicationStatus;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface GrantLifecycleTransitionResult {
  projectId: string;
  fromStatus: GrantApplicationStatus;
  toStatus: GrantApplicationStatus;
  changedAt: Date;
  changedByUserId: string;
  historyId: string;
}

export function isValidGrantApplicationStatus(value: unknown): value is GrantApplicationStatus {
  return typeof value === "string" && Object.values(GrantApplicationStatus).includes(value as GrantApplicationStatus);
}

export async function transitionGrantApplicationStatus(
  input: GrantLifecycleTransitionInput
): Promise<GrantLifecycleTransitionResult> {
  const canEditProject = await hasProjectAccess(
    input.actorUserId,
    input.projectId,
    ProjectAccessRole.EDITOR
  );

  if (!canEditProject) {
    throw new GrantLifecycleTransitionError(
      "Forbidden: You do not have access to change grant lifecycle status",
      403,
      "FORBIDDEN"
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      grantApplicationStatus: true,
    },
  });

  if (!project) {
    throw new GrantLifecycleTransitionError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const fromStatus = project.grantApplicationStatus;
  if (fromStatus === input.toStatus) {
    throw new GrantLifecycleTransitionError(
      "No-op transition is not allowed",
      400,
      "NO_OP_TRANSITION"
    );
  }

  const nextStatuses = ALLOWED_TRANSITIONS[fromStatus];
  if (!nextStatuses.includes(input.toStatus)) {
    throw new GrantLifecycleTransitionError(
      `Invalid transition from ${fromStatus} to ${input.toStatus}`,
      422,
      "INVALID_TRANSITION"
    );
  }

  const normalizedReason = input.reason?.trim() ?? null;
  if (input.toStatus === "REJECTED" && !normalizedReason) {
    throw new GrantLifecycleTransitionError(
      "A reason is required when transitioning to REJECTED",
      400,
      "INVALID_REASON"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: input.projectId },
      data: {
        grantApplicationStatus: input.toStatus,
      },
    });

    const historyEntry = await tx.grantApplicationStatusHistory.create({
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

  return result;
}
