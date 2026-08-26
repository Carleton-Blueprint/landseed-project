/**
 * FR-4.10: pre-estimate admin override of a project's modification scope.
 * Only valid while a project is "submitted" and no quote has been generated
 * yet (the delayed estimate-generation window from FR-4.10 phase 1). Once a
 * quote exists, this is rejected with ESTIMATE_ALREADY_GENERATED — the
 * post-estimate override (FR-4.3) that would otherwise handle that case
 * hasn't been built, so there's no redirect target to offer.
 *
 * Operates on per-photo declaredModificationCodes (the source of truth for
 * a project's modification scope) rather than a project-level list.
 */
import { ProjectStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  aggregateDeclaredModificationCodes,
  parseDeclaredModificationCodes,
} from "@/backend/eligibility/modificationNormalization";
import type { ModificationCode } from "@/backend/eligibility/types";
import { queueEligibilityEvaluation } from "@/backend/eligibility/triggers";

export const MODIFICATION_OVERRIDE_AUDIT_ACTION = "PROJECT_MODIFICATION_OVERRIDE_PRE_ESTIMATE";

export type ModificationOverrideErrorCode =
  | "PROJECT_NOT_FOUND"
  | "PROJECT_NOT_SUBMITTED"
  | "INVALID_PHOTO_MODIFICATIONS"
  | "ESTIMATE_ALREADY_GENERATED";

export class ModificationOverrideError extends Error {
  statusCode: number;
  code: ModificationOverrideErrorCode;

  constructor(message: string, statusCode: number, code: ModificationOverrideErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface PhotoModificationOverrideResult {
  photoId: string;
  declaredModificationCodes: ModificationCode[];
}

export interface ModificationOverrideResult {
  projectId: string;
  photos: PhotoModificationOverrideResult[];
  modificationCodes: ModificationCode[];
}

function estimateAlreadyGeneratedError(): ModificationOverrideError {
  return new ModificationOverrideError(
    "An estimate has already been generated for this project. A post-estimate modification override is not yet available.",
    409,
    "ESTIMATE_ALREADY_GENERATED"
  );
}

function projectNotSubmittedError(): ModificationOverrideError {
  return new ModificationOverrideError(
    "Modification overrides are only available for submitted projects awaiting their preliminary estimate",
    409,
    "PROJECT_NOT_SUBMITTED"
  );
}

function validatePhotoModifications(
  input: unknown,
  projectPhotoIds: Set<string>
): PhotoModificationOverrideResult[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ModificationOverrideError(
      "photoModifications must be a non-empty array",
      400,
      "INVALID_PHOTO_MODIFICATIONS"
    );
  }

  const seenPhotoIds = new Set<string>();
  const entries: PhotoModificationOverrideResult[] = [];

  for (const raw of input) {
    const photoId =
      raw && typeof raw === "object" ? (raw as { photoId?: unknown }).photoId : undefined;
    const codesRaw =
      raw && typeof raw === "object"
        ? (raw as { declaredModificationCodes?: unknown }).declaredModificationCodes
        : undefined;

    if (typeof photoId !== "string" || !photoId.trim() || !Array.isArray(codesRaw)) {
      throw new ModificationOverrideError(
        "Each photoModifications entry must have a photoId and a declaredModificationCodes array",
        400,
        "INVALID_PHOTO_MODIFICATIONS"
      );
    }

    if (!projectPhotoIds.has(photoId)) {
      throw new ModificationOverrideError(
        `Photo ${photoId} does not belong to this project`,
        400,
        "INVALID_PHOTO_MODIFICATIONS"
      );
    }

    if (seenPhotoIds.has(photoId)) {
      throw new ModificationOverrideError(
        `Duplicate photoId in photoModifications: ${photoId}`,
        400,
        "INVALID_PHOTO_MODIFICATIONS"
      );
    }
    seenPhotoIds.add(photoId);

    if (!codesRaw.every((c): c is string => typeof c === "string")) {
      throw new ModificationOverrideError(
        "declaredModificationCodes must contain only strings",
        400,
        "INVALID_PHOTO_MODIFICATIONS"
      );
    }

    const { codes, invalidCodes } = parseDeclaredModificationCodes(codesRaw);
    if (invalidCodes.length > 0) {
      throw new ModificationOverrideError(
        `Unrecognized modification code(s): ${invalidCodes.join(", ")}`,
        400,
        "INVALID_PHOTO_MODIFICATIONS"
      );
    }

    entries.push({ photoId, declaredModificationCodes: codes });
  }

  return entries;
}

export interface OverridePreEstimateModificationsInput {
  projectId: string;
  actorUserId: string;
  photoModifications: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function overridePreEstimateModifications(
  input: OverridePreEstimateModificationsInput
): Promise<ModificationOverrideResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      status: true,
      quotes: { select: { id: true }, take: 1 },
      photos: { select: { id: true, declaredModificationCodes: true } },
    },
  });

  if (!project) {
    throw new ModificationOverrideError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  if (project.quotes.length > 0) {
    throw estimateAlreadyGeneratedError();
  }

  if (project.status !== ProjectStatus.SUBMITTED) {
    throw projectNotSubmittedError();
  }

  const photosById = new Map(project.photos.map((p) => [p.id, p]));
  const entries = validatePhotoModifications(input.photoModifications, new Set(photosById.keys()));

  const originalCodes = aggregateDeclaredModificationCodes(project.photos);

  // Guard the write itself against the delayed estimate-generation job racing
  // us between the read above and this write: re-check project state inside
  // the transaction and abort (report the right error) if it changed.
  let raceLost = false;
  await prisma.$transaction(async (tx) => {
    const current = await tx.project.findUnique({
      where: { id: project.id },
      select: { status: true, quotes: { select: { id: true }, take: 1 } },
    });

    if (!current || current.status !== ProjectStatus.SUBMITTED || current.quotes.length > 0) {
      raceLost = true;
      return;
    }

    for (const entry of entries) {
      await tx.photo.update({
        where: { id: entry.photoId },
        data: { declaredModificationCodes: entry.declaredModificationCodes },
      });
    }
  });

  if (raceLost) {
    const latest = await prisma.project.findUnique({
      where: { id: project.id },
      select: { status: true, quotes: { select: { id: true }, take: 1 } },
    });
    throw latest && latest.quotes.length > 0 ? estimateAlreadyGeneratedError() : projectNotSubmittedError();
  }

  const updatedPhotos = await prisma.photo.findMany({
    where: { projectId: project.id },
    select: { declaredModificationCodes: true },
  });
  const newCodes = aggregateDeclaredModificationCodes(updatedPhotos);

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: MODIFICATION_OVERRIDE_AUDIT_ACTION,
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: input.actorUserId,
    projectId: project.id,
    resourceType: "project",
    resourceId: project.id,
    description: "Admin overrode per-photo modification tags before preliminary estimate generation",
    beforeState: {
      photos: entries.map((e) => ({
        photoId: e.photoId,
        declaredModificationCodes: photosById.get(e.photoId)?.declaredModificationCodes ?? [],
      })),
      modificationCodes: originalCodes,
      source: "intake_submission",
    },
    afterState: {
      photos: entries,
      modificationCodes: newCodes,
      source: "admin_override",
    },
    reason: input.reason ?? null,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  // Photo tags changed, so re-evaluate eligibility now rather than waiting
  // for the delayed estimate-generation job.
  await queueEligibilityEvaluation(project.id);

  return {
    projectId: project.id,
    photos: entries,
    modificationCodes: newCodes,
  };
}
