/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { uploadToS3 } from "lib/s3";
import { virusScanQueue } from "@/backend/queue";
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
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("lib/s3", () => ({
  uploadToS3: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  virusScanQueue: { add: jest.fn() },
}));

const { requireAdminWithMfaEnrolled } = jest.requireMock("@/backend/auth/requireAdminMfa") as {
  requireAdminWithMfaEnrolled: jest.Mock;
};
const { HttpError } = jest.requireMock("@/backend/auth/requireRole") as {
  HttpError: new (message: string, status?: number) => Error & { status: number };
};

const projectId = "project-1";
const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };

function buildParams() {
  return { params: Promise.resolve({ projectId }) };
}

function buildGetRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/admin/projects/${projectId}/documents`);
}

function buildUploadRequest(fields: Record<string, string> = {}): NextRequest {
  const formData = new FormData();
  formData.set("file", new File(["x"], "doc.pdf", { type: "application/pdf" }));
  formData.set("documentType", "OTHER");
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new NextRequest(`http://localhost/api/admin/projects/${projectId}/documents`, {
    method: "POST",
    body: formData,
  });
}

describe("/api/admin/projects/[projectId]/documents", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAdminWithMfaEnrolled.mockResolvedValue(true);
  });

  describe("GET", () => {
    it("denies non-admin/unenrolled callers and logs the attempt", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1", email: "client@example.com" } });
      requireAdminWithMfaEnrolled.mockRejectedValue(new HttpError("forbidden", 403));

      const response = await GET(buildGetRequest(), buildParams());

      expect(response.status).toBe(403);
      expect(logDeniedAdminAccessAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: "route",
          actorUserId: "user-1",
          routePath: `/api/admin/projects/${projectId}/documents`,
          method: "GET",
          resourceType: "Document",
          projectId,
          reason: "forbidden",
        })
      );
      expect(prisma.document.findMany).not.toHaveBeenCalled();
    });

    it("returns documents, including isClientVisible, for admin users", async () => {
      (auth as jest.Mock).mockResolvedValue(adminSession);
      const doc = {
        id: "doc-1",
        fileName: "doc.pdf",
        fileSize: 10,
        mimeType: "application/pdf",
        documentType: "OTHER",
        label: null,
        virusScanStatus: "pending",
        reviewStatus: "PENDING",
        reviewNote: null,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        isClientVisible: false,
      };
      (prisma.document.findMany as jest.Mock).mockResolvedValue([doc]);

      const response = await GET(buildGetRequest(), buildParams());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ documents: [{ ...doc, createdAt: doc.createdAt.toISOString() }] });
      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId } })
      );
    });
  });

  describe("POST", () => {
    it("denies non-admin/unenrolled callers and logs the attempt", async () => {
      (auth as jest.Mock).mockResolvedValue(null);
      requireAdminWithMfaEnrolled.mockRejectedValue(new HttpError("unauthenticated", 401));

      const response = await POST(buildUploadRequest(), buildParams());

      expect(response.status).toBe(401);
      expect(logDeniedAdminAccessAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: null, method: "POST", resourceType: "Document" })
      );
      expect(uploadToS3).not.toHaveBeenCalled();
    });

    it("uploads a document defaulting isClientVisible to true", async () => {
      (auth as jest.Mock).mockResolvedValue(adminSession);
      (uploadToS3 as jest.Mock).mockResolvedValue("https://s3.example.com/doc.pdf");
      (prisma.document.create as jest.Mock).mockResolvedValue({ id: "doc-1", isClientVisible: true });
      (virusScanQueue.add as jest.Mock).mockResolvedValue(undefined);

      const response = await POST(buildUploadRequest(), buildParams());
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.document).toEqual({ id: "doc-1", isClientVisible: true });
      expect(prisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isClientVisible: true, uploadedByUserId: "admin-1" }),
        })
      );
      expect(virusScanQueue.add).toHaveBeenCalled();
    });

    it("uploads a document with isClientVisible=false when explicitly set", async () => {
      (auth as jest.Mock).mockResolvedValue(adminSession);
      (uploadToS3 as jest.Mock).mockResolvedValue("https://s3.example.com/doc.pdf");
      (prisma.document.create as jest.Mock).mockResolvedValue({ id: "doc-1", isClientVisible: false });
      (virusScanQueue.add as jest.Mock).mockResolvedValue(undefined);

      const response = await POST(buildUploadRequest({ isClientVisible: "false" }), buildParams());

      expect(response.status).toBe(201);
      expect(prisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isClientVisible: false }) })
      );
    });

    it("rejects files over the 15MB limit", async () => {
      (auth as jest.Mock).mockResolvedValue(adminSession);

      const formData = new FormData();
      const bigFile = new File([new Uint8Array(15 * 1024 * 1024 + 1)], "big.pdf", {
        type: "application/pdf",
      });
      formData.set("file", bigFile);
      formData.set("documentType", "OTHER");
      const request = new NextRequest(`http://localhost/api/admin/projects/${projectId}/documents`, {
        method: "POST",
        body: formData,
      });

      const response = await POST(request, buildParams());

      expect(response.status).toBe(400);
      expect(uploadToS3).not.toHaveBeenCalled();
    });
  });
});
