/**
 * Signature / acknowledgement capture for grant applications. Records are
 * insert-only — there is deliberately no update/delete path here, so a
 * corrected or repeat signature is always a new row, never a mutation of
 * an existing one. See /api/project/{id}/grant-signature.
 */

import { GrantAcknowledgementType } from "@prisma/client";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";

export const GRANT_SIGNATURE_DATA_MAX_LENGTH = 500_000; // ~375KB decoded; covers a small canvas-drawn PNG data URI or a typed name
export const GRANT_SIGNATURE_DATA_MIN_LENGTH = 1;

export const GRANT_SIGNATURE_AUDIT_ACTIONS = {
  CREATE: "GRANT_SIGNATURE_CREATE",
} as const;

// Acknowledgements required to consider a project's grant application fully
// signed. Currently the same set for every project — there's no per-grant
// configuration in the schema, so this is a single shared default.
export const REQUIRED_GRANT_ACKNOWLEDGEMENT_TYPES: GrantAcknowledgementType[] = [
  GrantAcknowledgementType.CONSENT_TO_SUBMIT,
  GrantAcknowledgementType.ACCURACY_ATTESTATION,
  GrantAcknowledgementType.INFORMATION_SHARING_CONSENT,
  GrantAcknowledgementType.TERMS_AND_CONDITIONS,
];

const VALID_ACKNOWLEDGEMENT_TYPES = Object.values(GrantAcknowledgementType);

type GrantSignatureErrorCode = "PROJECT_NOT_FOUND" | "INVALID_ACKNOWLEDGEMENT_TYPE" | "INVALID_SIGNATURE_DATA";

export class GrantSignatureError extends Error {
  statusCode: number;
  code: GrantSignatureErrorCode;

  constructor(message: string, statusCode: number, code: GrantSignatureErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface SerializedGrantSignature {
  id: string;
  projectId: string;
  signerUserId: string;
  acknowledgementType: GrantAcknowledgementType;
  signedAt: Date;
  createdAt: Date;
}

export interface GrantSignatureStatusEntry {
  acknowledgementType: GrantAcknowledgementType;
  isSigned: boolean;
  signerUserId: string | null;
  signedAt: Date | null;
  signatureId: string | null;
}

function serializeGrantSignature(row: {
  id: string;
  projectId: string;
  signerUserId: string;
  acknowledgementType: GrantAcknowledgementType;
  signedAt: Date;
  createdAt: Date;
}): SerializedGrantSignature {
  return {
    id: row.id,
    projectId: row.projectId,
    signerUserId: row.signerUserId,
    acknowledgementType: row.acknowledgementType,
    signedAt: row.signedAt,
    createdAt: row.createdAt,
  };
}

function normalizeAcknowledgementType(acknowledgementType: unknown): GrantAcknowledgementType {
  if (
    typeof acknowledgementType !== "string" ||
    !VALID_ACKNOWLEDGEMENT_TYPES.includes(acknowledgementType as GrantAcknowledgementType)
  ) {
    throw new GrantSignatureError(
      `Acknowledgement type must be one of: ${VALID_ACKNOWLEDGEMENT_TYPES.join(", ")}`,
      400,
      "INVALID_ACKNOWLEDGEMENT_TYPE"
    );
  }

  return acknowledgementType as GrantAcknowledgementType;
}

function normalizeSignatureData(signatureData: unknown): string {
  if (typeof signatureData !== "string") {
    throw new GrantSignatureError("Signature data must be a string", 400, "INVALID_SIGNATURE_DATA");
  }

  const normalized = signatureData.trim();
  if (normalized.length < GRANT_SIGNATURE_DATA_MIN_LENGTH) {
    throw new GrantSignatureError("Signature data is required", 400, "INVALID_SIGNATURE_DATA");
  }

  if (normalized.length > GRANT_SIGNATURE_DATA_MAX_LENGTH) {
    throw new GrantSignatureError(
      `Signature data must be at most ${GRANT_SIGNATURE_DATA_MAX_LENGTH} characters`,
      400,
      "INVALID_SIGNATURE_DATA"
    );
  }

  return normalized;
}

export async function createGrantSignature(input: {
  projectId: string;
  signerUserId: string;
  acknowledgementType: unknown;
  signatureData: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<SerializedGrantSignature> {
  const acknowledgementType = normalizeAcknowledgementType(input.acknowledgementType);
  const signatureData = normalizeSignatureData(input.signatureData);

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });

  if (!project) {
    throw new GrantSignatureError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const signature = await prisma.grantSignature.create({
    data: {
      projectId: project.id,
      signerUserId: input.signerUserId,
      acknowledgementType,
      signatureData,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  await logAuditEventNonBlocking({
    category: "SENSITIVE_ACCESS",
    action: GRANT_SIGNATURE_AUDIT_ACTIONS.CREATE,
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.signerUserId,
    projectId: project.id,
    resourceType: "GrantSignature",
    resourceId: signature.id,
    description: `Signed grant acknowledgement: ${acknowledgementType}`,
    metadata: { acknowledgementType },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return serializeGrantSignature(signature);
}

export async function getGrantSignatureStatusForProject(
  projectId: string
): Promise<{ isComplete: boolean; acknowledgements: GrantSignatureStatusEntry[] }> {
  const latestByType = await Promise.all(
    REQUIRED_GRANT_ACKNOWLEDGEMENT_TYPES.map(async (acknowledgementType) => {
      const latest = await prisma.grantSignature.findFirst({
        where: { projectId, acknowledgementType },
        orderBy: { signedAt: "desc" },
        select: { id: true, signerUserId: true, signedAt: true },
      });

      return {
        acknowledgementType,
        isSigned: Boolean(latest),
        signerUserId: latest?.signerUserId ?? null,
        signedAt: latest?.signedAt ?? null,
        signatureId: latest?.id ?? null,
      };
    })
  );

  return {
    isComplete: latestByType.every((entry) => entry.isSigned),
    acknowledgements: latestByType,
  };
}
