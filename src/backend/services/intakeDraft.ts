import {
  GrantApplicationStatus,
  Prisma,
  ProjectAccessRole,
} from "@prisma/client";
import { prisma } from "lib/prisma";
import type { GuidedData, IntakeData, PromoteIntakeData } from "@/backend/schemas/intakeDraft";
import { promoteIntakeDataSchema } from "@/backend/schemas/intakeDraft";
import type { FinalizeIntakeResult } from "@/backend/services/finalizeIntake";

export interface MergeIntakeDraftInput {
  guidedData?: GuidedData;
  intakeData?: IntakeData;
}

export interface IntakeDraftPhoto {
  id: string;
  url: string;
}

const EDITABLE_ROLES: ProjectAccessRole[] = [
  ProjectAccessRole.OWNER,
  ProjectAccessRole.EDITOR,
];

export const SHELL_PROJECT_ADDRESS = "Draft – address not yet set";

export function deriveAddressFromIntakeData(
  intakeData: Pick<PromoteIntakeData, "addressLine1" | "city" | "province" | "postalCode">
): string {
  const addressParts = [
    intakeData.addressLine1,
    intakeData.city,
    intakeData.province,
    intakeData.postalCode,
  ].filter(Boolean);

  return addressParts.length > 0 ? addressParts.join(", ") : SHELL_PROJECT_ADDRESS;
}

export async function getIntakeDraft(userId: string) {
  return prisma.intakeDraft.findUnique({
    where: { userId },
  });
}

export async function getOrCreateIntakeDraft(userId: string) {
  return prisma.intakeDraft.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function mergeIntakeDraft(userId: string, input: MergeIntakeDraftInput) {
  await getOrCreateIntakeDraft(userId);

  const data: Prisma.IntakeDraftUpdateInput = {};

  if (input.guidedData !== undefined) {
    data.guidedData = input.guidedData as Prisma.InputJsonValue;
  }

  if (input.intakeData !== undefined) {
    data.intakeData = input.intakeData as Prisma.InputJsonValue;
  }

  return prisma.intakeDraft.update({
    where: { userId },
    data,
  });
}

async function findLegacyDraftProject(userId: string) {
  return prisma.project.findFirst({
    where: {
      status: "draft",
      draftData: { not: Prisma.DbNull },
      projectAccess: {
        some: {
          userId,
          role: { in: EDITABLE_ROLES },
        },
      },
    },
    select: { id: true, draftData: true },
    orderBy: { updatedAt: "desc" },
  });
}

/** Import legacy Project.draftData into IntakeDraft when no row exists yet. */
export async function importLegacyDraftIfNeeded(userId: string) {
  const existing = await getIntakeDraft(userId);
  if (existing) {
    return existing;
  }

  const legacyProject = await findLegacyDraftProject(userId);
  if (!legacyProject?.draftData) {
    return null;
  }

  return prisma.intakeDraft.create({
    data: {
      userId,
      intakeData: legacyProject.draftData as Prisma.InputJsonValue,
      projectId: legacyProject.id,
    },
  });
}

export async function loadIntakeDraftWithPhotos(userId: string) {
  const draft = await importLegacyDraftIfNeeded(userId);
  if (!draft) {
    return null;
  }

  let photos: IntakeDraftPhoto[] = [];
  if (draft.projectId) {
    photos = await prisma.photo.findMany({
      where: { projectId: draft.projectId },
      select: { id: true, url: true },
      orderBy: { createdAt: "asc" },
    });
  }

  return { draft, photos };
}

async function createShellProject(userId: string) {
  return prisma.project.create({
    data: {
      userId,
      status: "draft",
      grantApplicationStatus: GrantApplicationStatus.DRAFT,
      address: SHELL_PROJECT_ADDRESS,
      projectAccess: {
        create: {
          userId,
          role: ProjectAccessRole.OWNER,
          grantedByUserId: userId,
        },
      },
      grantApplicationStatusHistory: {
        create: {
          fromStatus: null,
          toStatus: GrantApplicationStatus.DRAFT,
          changedByUserId: userId,
          metadata: {
            source: "intake_draft_shell",
          } as Prisma.InputJsonValue,
        },
      },
    },
  });
}

/** Create or return the shell draft project linked to this intake draft. */
export async function ensureShellProject(userId: string) {
  const draft = await getOrCreateIntakeDraft(userId);

  if (draft.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: draft.projectId },
      select: { id: true, status: true },
    });

    if (project?.status === "draft") {
      return { draft, project };
    }
  }

  const project = await createShellProject(userId);
  const updatedDraft = await prisma.intakeDraft.update({
    where: { userId },
    data: { projectId: project.id },
  });

  return { draft: updatedDraft, project };
}

export interface PromoteIntakeDraftInput {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type PromoteIntakeDraftResult =
  | FinalizeIntakeResult
  | {
      ok: false;
      code: "DRAFT_NOT_FOUND" | "INCOMPLETE_INTAKE";
      message: string;
      details?: unknown;
    };

export async function promoteIntakeDraft(
  userId: string,
  input: PromoteIntakeDraftInput
): Promise<PromoteIntakeDraftResult> {
  const draft = await getIntakeDraft(userId);
  if (!draft) {
    return {
      ok: false,
      code: "DRAFT_NOT_FOUND",
      message: "No intake draft found for this user.",
    };
  }

  const parsed = promoteIntakeDataSchema.safeParse(draft.intakeData ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      code: "INCOMPLETE_INTAKE",
      message: "Intake data is incomplete or invalid.",
      details: parsed.error.flatten(),
    };
  }

  const intakeData = parsed.data;
  const guidedData =
    draft.guidedData && typeof draft.guidedData === "object" && !Array.isArray(draft.guidedData)
      ? (draft.guidedData as Record<string, unknown>)
      : {};

  const { project } = await ensureShellProject(userId);
  const mergedDraftData = { ...intakeData, ...guidedData };
  const address = deriveAddressFromIntakeData(intakeData);

  await prisma.project.update({
    where: { id: project.id },
    data: {
      draftData: mergedDraftData as Prisma.InputJsonValue,
      address,
    },
  });

  const { finalizeIntake } = await import("@/backend/services/finalizeIntake");
  const finalizeResult = await finalizeIntake({
    projectId: project.id,
    actorUserId: input.actorUserId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  if (!finalizeResult.ok) {
    return finalizeResult;
  }

  await prisma.intakeDraft.delete({ where: { userId } });

  return finalizeResult;
}

export async function deleteIntakeDraft(userId: string) {
  const draft = await getIntakeDraft(userId);
  if (!draft) {
    return { deleted: false };
  }

  await prisma.$transaction(async (tx) => {
    if (draft.projectId) {
      const project = await tx.project.findUnique({
        where: { id: draft.projectId },
        select: { status: true },
      });

      if (project?.status === "draft") {
        await tx.project.delete({ where: { id: draft.projectId } });
      }
    }

    await tx.intakeDraft.delete({ where: { userId } });
  });

  return { deleted: true };
}
