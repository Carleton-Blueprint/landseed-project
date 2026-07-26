/**
 * Staff-initiated requests for additional photos, documents, or information
 * from a client. Created via /api/admin/projects/{projectId}/information-requests.
 */

import { InformationRequestStatus, InformationRequestType } from "@prisma/client";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";

export const INFORMATION_REQUEST_MESSAGE_MAX_LENGTH = 2000;
export const INFORMATION_REQUEST_MESSAGE_MIN_LENGTH = 10;

export const INFORMATION_REQUEST_AUDIT_ACTIONS = {
  CREATE: "INFORMATION_REQUEST_CREATE",
  NOTIFICATION_FAILED: "INFORMATION_REQUEST_NOTIFICATION_FAILED",
  RESPONDED: "INFORMATION_REQUEST_RESPONDED",
} as const;

const OPEN_STATUSES: InformationRequestStatus[] = [
  InformationRequestStatus.PENDING,
  InformationRequestStatus.FOLLOW_UP_FLAGGED,
];

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
  respondedAt: Date | null;
  followUpFlaggedAt: Date | null;
}

function serializeInformationRequest(row: {
  id: string;
  projectId: string;
  requestType: InformationRequestType;
  message: string;
  status: InformationRequestStatus;
  requestedByUserId: string;
  createdAt: Date;
  respondedAt: Date | null;
  followUpFlaggedAt: Date | null;
}): SerializedInformationRequest {
  return {
    id: row.id,
    projectId: row.projectId,
    requestType: row.requestType,
    message: row.message,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
    followUpFlaggedAt: row.followUpFlaggedAt,
  };
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
    informationRequest: serializeInformationRequest(informationRequest),
    project,
  };
}

export async function listInformationRequestsForProject(
  projectId: string
): Promise<SerializedInformationRequest[]> {
  const rows = await prisma.informationRequest.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  return rows.map(serializeInformationRequest);
}

/**
 * Best-effort: marks information requests on a project as RESPONDED.
 *
 * When `informationRequestId` is given, only that specific request is
 * resolved (validated as open and belonging to this project) — this is the
 * path used when an upload is explicitly tied to one request via the
 * upload UI. If it doesn't match an open request on this project, this is
 * a no-op rather than an error, since it's called best-effort from upload
 * routes and shouldn't fail the upload itself.
 *
 * When omitted, every open (PENDING or FOLLOW_UP_FLAGGED) request on the
 * project is marked responded — the fallback for uploads that aren't tied
 * to a specific request (e.g. a general document upload).
 */
export async function markInformationRequestsRespondedForProject(
  projectId: string,
  respondedByUserId: string,
  informationRequestId?: string
): Promise<number> {
  const openRequests = await prisma.informationRequest.findMany({
    where: {
      projectId,
      status: { in: OPEN_STATUSES },
      ...(informationRequestId ? { id: informationRequestId } : {}),
    },
    select: { id: true },
  });

  if (openRequests.length === 0) {
    return 0;
  }

  const respondedAt = new Date();
  await prisma.informationRequest.updateMany({
    where: { id: { in: openRequests.map((r) => r.id) } },
    data: { status: InformationRequestStatus.RESPONDED, respondedAt },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: INFORMATION_REQUEST_AUDIT_ACTIONS.RESPONDED,
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: respondedByUserId,
    projectId,
    resourceType: "InformationRequest",
    description: informationRequestId
      ? "Client upload marked a specific information request as responded"
      : "Client upload marked all open information requests as responded",
    metadata: { informationRequestIds: openRequests.map((r) => r.id) },
  });

  return openRequests.length;
}
