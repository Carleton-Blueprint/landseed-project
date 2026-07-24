/**
 * Staff-initiated requests for additional photos, documents, or information
 * from a client. Created via /api/admin/projects/{projectId}/information-requests.
 */

import { InformationRequestType } from "@prisma/client";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";

export const INFORMATION_REQUEST_MESSAGE_MAX_LENGTH = 2000;
export const INFORMATION_REQUEST_MESSAGE_MIN_LENGTH = 10;

export const INFORMATION_REQUEST_AUDIT_ACTIONS = {
  CREATE: "INFORMATION_REQUEST_CREATE",
  NOTIFICATION_FAILED: "INFORMATION_REQUEST_NOTIFICATION_FAILED",
} as const;

const VALID_REQUEST_TYPES = Object.values(InformationRequestType);

type InformationRequestErrorCode = "PROJECT_NOT_FOUND" | "INVALID_REQUEST_TYPE" | "INVALID_MESSAGE";

export class InformationRequestError extends Error {
  statusCode: number;
  code: InformationRequestErrorCode;

  constructor(message: string, statusCode: number, code: InformationRequestErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface SerializedInformationRequest {
  id: string;
  projectId: string;
  requestType: InformationRequestType;
  message: string;
  status: string;
  requestedByUserId: string;
  createdAt: Date;
}

function normalizeRequestType(requestType: unknown): InformationRequestType {
  if (typeof requestType !== "string" || !VALID_REQUEST_TYPES.includes(requestType as InformationRequestType)) {
    throw new InformationRequestError(
      `Request type must be one of: ${VALID_REQUEST_TYPES.join(", ")}`,
      400,
      "INVALID_REQUEST_TYPE"
    );
  }

  return requestType as InformationRequestType;
}

function normalizeMessage(message: unknown): string {
  if (typeof message !== "string") {
    throw new InformationRequestError("Message must be a string", 400, "INVALID_MESSAGE");
  }

  const normalized = message.trim();
  if (normalized.length < INFORMATION_REQUEST_MESSAGE_MIN_LENGTH) {
    throw new InformationRequestError(
      `Message must be at least ${INFORMATION_REQUEST_MESSAGE_MIN_LENGTH} characters`,
      400,
      "INVALID_MESSAGE"
    );
  }

  if (normalized.length > INFORMATION_REQUEST_MESSAGE_MAX_LENGTH) {
    throw new InformationRequestError(
      `Message must be at most ${INFORMATION_REQUEST_MESSAGE_MAX_LENGTH} characters`,
      400,
      "INVALID_MESSAGE"
    );
  }

  return normalized;
}

export async function createInformationRequest(input: {
  projectId: string;
  requestedByUserId: string;
  requestType: unknown;
  message: unknown;
}): Promise<{
  informationRequest: SerializedInformationRequest;
  project: { id: string; address: string; userId: string; user: { id: string; email: string | null; name: string | null } };
}> {
  const requestType = normalizeRequestType(input.requestType);
  const message = normalizeMessage(input.message);

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      address: true,
      userId: true,
      user: { select: { id: true, email: true, name: true } },
    },
  });

  if (!project) {
    throw new InformationRequestError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const informationRequest = await prisma.informationRequest.create({
    data: {
      projectId: project.id,
      requestType,
      message,
      requestedByUserId: input.requestedByUserId,
    },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: INFORMATION_REQUEST_AUDIT_ACTIONS.CREATE,
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: input.requestedByUserId,
    projectId: project.id,
    resourceType: "InformationRequest",
    resourceId: informationRequest.id,
    description: `Staff requested ${requestType.toLowerCase()} from client`,
    metadata: { requestType, message },
  });

  return {
    informationRequest: {
      id: informationRequest.id,
      projectId: informationRequest.projectId,
      requestType: informationRequest.requestType,
      message: informationRequest.message,
      status: informationRequest.status,
      requestedByUserId: informationRequest.requestedByUserId,
      createdAt: informationRequest.createdAt,
    },
    project,
  };
}
