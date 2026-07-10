/**
 * FR-4.10: pre-estimate admin override of intake modification type/scope.
 * Only valid while a project is "submitted" and no quote has been generated
 * yet (the delayed estimate-generation window from FR-4.10 phase 1). Once a
 * quote exists, callers must use the post-estimate override (FR-4.3) instead.
 */
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  MODIFICATION_NORMALIZATION_MAP,
  normalizeLabel,
  normalizeModificationItems,
} from "@/backend/eligibility/modificationNormalization";
import type { ModificationCode } from "@/backend/eligibility/types";

export const MODIFICATION_OVERRIDE_AUDIT_ACTION = "PROJECT_MODIFICATION_OVERRIDE_PRE_ESTIMATE";
export const POST_ESTIMATE_OVERRIDE_REDIRECT = "post_estimate_override";

export type ModificationOverrideErrorCode =
  | "PROJECT_NOT_FOUND"
  | "PROJECT_NOT_SUBMITTED"
  | "INVALID_MODIFICATION_ITEMS"
  | "ESTIMATE_ALREADY_GENERATED";

export class ModificationOverrideError extends Error {
  statusCode: number;
  code: ModificationOverrideErrorCode;
  redirectTo?: string;

  constructor(
    message: string,
    statusCode: number,
    code: ModificationOverrideErrorCode,
    redirectTo?: string
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.redirectTo = redirectTo;
  }
}

export interface ModificationOverrideResult {
  projectId: string;
  modificationItems: string[];
  modificationCodes: ModificationCode[];
}

function readModificationItems(draftData: unknown): string[] {
  if (!draftData || typeof draftData !== "object" || Array.isArray(draftData)) {
    return [];
  }

  const items = (draftData as { modificationItems?: unknown }).modificationItems;
  return Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
}

function validateModificationItems(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ModificationOverrideError(
      "modificationItems must be a non-empty array of strings",
      400,
      "INVALID_MODIFICATION_ITEMS"
    );
  }

  const items: string[] = [];
  const unknown: string[] = [];

  for (const raw of input) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new ModificationOverrideError(
        "modificationItems must contain only non-empty strings",
        400,
        "INVALID_MODIFICATION_ITEMS"
      );
    }

    const trimmed = raw.trim();
    if (!MODIFICATION_NORMALIZATION_MAP[normalizeLabel(trimmed)]) {
      unknown.push(trimmed);
      continue;
    }

    items.push(trimmed);
  }

  if (unknown.length > 0) {
    throw new ModificationOverrideError(
      `Unrecognized modification item(s): ${unknown.join(", ")}`,
      400,
      "INVALID_MODIFICATION_ITEMS"
    );
  }

  return items;
}

export interface OverridePreEstimateModificationsInput {
  projectId: string;
  actorUserId: string;
  modificationItems: unknown;
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
      draftData: true,
      quotes: { select: { id: true }, take: 1 },
    },
  });

  if (!project) {
    throw new ModificationOverrideError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  if (project.quotes.length > 0) {
    throw new ModificationOverrideError(
      "An estimate has already been generated for this project. Use the post-estimate modification override instead.",
      409,
      "ESTIMATE_ALREADY_GENERATED",
      POST_ESTIMATE_OVERRIDE_REDIRECT
    );
  }

  if (project.status !== "submitted") {
    throw new ModificationOverrideError(
      "Modification overrides are only available for submitted projects awaiting their preliminary estimate",
      409,
      "PROJECT_NOT_SUBMITTED"
    );
  }

  const newModificationItems = validateModificationItems(input.modificationItems);
  const newCodes = normalizeModificationItems(newModificationItems);

  const originalModificationItems = readModificationItems(project.draftData);
  const originalCodes = normalizeModificationItems(originalModificationItems);

  const updatedDraftData = {
    ...(project.draftData && typeof project.draftData === "object" && !Array.isArray(project.draftData)
      ? (project.draftData as Record<string, unknown>)
      : {}),
    modificationItems: newModificationItems,
  };

  await prisma.project.update({
    where: { id: project.id },
    data: { draftData: updatedDraftData },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: MODIFICATION_OVERRIDE_AUDIT_ACTION,
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: input.actorUserId,
    projectId: project.id,
    resourceType: "project",
    resourceId: project.id,
    description: "Admin overrode intake modification items before preliminary estimate generation",
    beforeState: {
      modificationItems: originalModificationItems,
      modificationCodes: originalCodes,
      source: "intake_submission",
    },
    afterState: {
      modificationItems: newModificationItems,
      modificationCodes: newCodes,
      source: "admin_override",
    },
    reason: input.reason ?? null,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    projectId: project.id,
    modificationItems: newModificationItems,
    modificationCodes: newCodes,
  };
}
