/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { PATCH } from "../route";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/auth/requireRole", () => ({
  HttpError: class HttpError extends Error {
    status: number;

    constructor(message: string, status = 403) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock("@/backend/auth/requireAdminMfa", () => ({
  MfaSetupRequiredError: class MfaSetupRequiredError extends Error {
    status = 403;
    code = "MFA_SETUP_REQUIRED";
  },
  requireAdminWithMfaEnrolled: jest.fn(),
}));

jest.mock("@/backend/audit/requestContext", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: "198.51.100.2", userAgent: "jest" })),
}));

jest.mock("@/backend/audit/adminAccess", () => ({
  logDeniedAdminAccessAttempt: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    document: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const { requireAdminWithMfaEnrolled } = jest.requireMock("@/backend/auth/requireAdminMfa") as {
  requireAdminWithMfaEnrolled: jest.Mock;
};
const { HttpError } = jest.requireMock("@/backend/auth/requireRole") as {
  HttpError: new (message: string, status?: number) => Error & { status: number };
};

const projectId = "project-1";
const documentId = "doc-1";
const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };

function buildParams() {
  return { params: Promise.resolve({ projectId, documentId }) };
}

function buildRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/projects/${projectId}/documents/${documentId}/visibility`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }
  );
}

describe("/api/admin/projects/[projectId]/documents/[documentId]/visibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAdminWithMfaEnrolled.mockResolvedValue(true);
  });

  it("denies non-admin/unenrolled callers and logs the attempt", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1", email: "client@example.com" } });
    requireAdminWithMfaEnrolled.mockRejectedValue(new HttpError("forbidden", 403));

    const response = await PATCH(buildRequest({ isClientVisible: false }), buildParams());

    expect(response.status).toBe(403);
    expect(logDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "route",
        actorUserId: "user-1",
        routePath: `/api/admin/projects/${projectId}/documents/${documentId}/visibility`,
        method: "PATCH",
        resourceType: "Document",
        resourceId: documentId,
        projectId,
        reason: "forbidden",
      })
    );
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-boolean isClientVisible value", async () => {
    (auth as jest.Mock).mockResolvedValue(adminSession);

    const response = await PATCH(buildRequest({ isClientVisible: "false" }), buildParams());

    expect(response.status).toBe(400);
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the document doesn't exist on the project", async () => {
    (auth as jest.Mock).mockResolvedValue(adminSession);
    (prisma.document.findUnique as jest.Mock).mockResolvedValue(null);

    const response = await PATCH(buildRequest({ isClientVisible: false }), buildParams());

    expect(response.status).toBe(404);
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it("toggles isClientVisible for an existing document", async () => {
    (auth as jest.Mock).mockResolvedValue(adminSession);
    (prisma.document.findUnique as jest.Mock).mockResolvedValue({ id: documentId, projectId });
    (prisma.document.update as jest.Mock).mockResolvedValue({ id: documentId, isClientVisible: false });

    const response = await PATCH(buildRequest({ isClientVisible: false }), buildParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ document: { id: documentId, isClientVisible: false } });
    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: { isClientVisible: false },
      select: { id: true, isClientVisible: true },
    });
  });
});
