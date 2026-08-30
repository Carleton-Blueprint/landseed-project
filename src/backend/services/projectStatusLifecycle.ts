import { Prisma, ProjectStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { requestManualFallbackExport } from "@/backend/services/manualFallbackExport";

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

  // Approval triggers generation of the downloadable BuilderTrend export
  // package (estimate PDF, grant match summary PDF, grant application PDF,
  // project data) that staff download and push to BuilderTrend manually —
  // LandSeed does not integrate with BuilderTrend's API directly. Fire-and-
  // forget: this is a best-effort side effect, not part of the approval
  // transaction itself; the export can always be regenerated on demand from
  // the admin dashboard if this fails.
  if (input.toStatus === "APPROVED") {
    requestManualFallbackExport({
      projectId: input.projectId,
      requestedByUserId: input.actorUserId,
    })
      .then((exportRequest) => {
        logAuditEventNonBlocking({
          category: "MANUAL_CHANGE",
          action: "BUILDERTREND_EXPORT_TRIGGERED_BY_PROJECT_APPROVAL",
          outcome: "SUCCESS",
          sensitivityLevel: "RESTRICTED",
          actorUserId: input.actorUserId,
          projectId: input.projectId,
          resourceType: "manual_fallback_export",
          resourceId: exportRequest.exportRequestId,
          description: "BuilderTrend export package generation queued now that the project has been approved",
        });
      })
      .catch((err) => {
        console.warn("Failed to generate BuilderTrend export package for approved project", input.projectId, err);
      });
  }

  return result;
}
