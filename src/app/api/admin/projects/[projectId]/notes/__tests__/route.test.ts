import { beforeEach, describe, expect, it, jest } from "@jest/globals";
/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock("@/auth", () => ({
  auth: jest.fn<() => Promise<unknown>>(),
}));

jest.mock("@/backend/auth/requireRole", () => ({
  HttpError: class HttpError extends Error {
    status: number;

    constructor(message: string, status = 403) {
      super(message);
      this.status = status;
    }
  },
  requireMinimumRole: jest.fn<() => Promise<boolean>>(),
}));

jest.mock("@/backend/audit/requestContext", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: "198.51.100.2", userAgent: "jest" })),
}));

jest.mock("@/backend/audit/adminAccess", () => ({
  logDeniedAdminAccessAttempt: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
}));

jest.mock("@/backend/services/projectStaffNotes", () => ({
  ProjectStaffNoteError: class ProjectStaffNoteError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode: number, code: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  listNotesForProject: jest.fn(),
  createNote: jest.fn(),
}));

(globalThis as { Response?: { json: (body: unknown, init?: { status?: number }) => Response } }).Response = {
  json: (body: unknown, init?: { status?: number }) =>
    ({
      status: init?.status ?? 200,
      json: async () => body,
    }) as Response,
};

const { GET, POST } = require("../route") as {
  GET: (request: Request, context: { params: Promise<{ projectId: string }> }) => Promise<Response>;
  POST: (request: Request, context: { params: Promise<{ projectId: string }> }) => Promise<Response>;
};

const { auth } = require("@/auth") as { auth: jest.Mock };
const { requireMinimumRole, HttpError } = require("@/backend/auth/requireRole") as {
  requireMinimumRole: jest.Mock;
  HttpError: new (message: string, status?: number) => Error & { status: number };
};
const { logDeniedAdminAccessAttempt } = require("@/backend/audit/adminAccess") as {
  logDeniedAdminAccessAttempt: jest.Mock;
};
const { listNotesForProject, createNote, ProjectStaffNoteError } = require("@/backend/services/projectStaffNotes") as {
  listNotesForProject: jest.Mock;
  createNote: jest.Mock;
  ProjectStaffNoteError: new (message: string, statusCode: number, code: string) => Error & {
    statusCode: number;
    code: string;
  };
};

const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedRequireMinimumRole = requireMinimumRole as jest.MockedFunction<() => Promise<boolean>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;
const mockedListNotesForProject = listNotesForProject as jest.MockedFunction<typeof listNotesForProject>;
const mockedCreateNote = createNote as jest.MockedFunction<typeof createNote>;

const projectId = "project-1";
const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };
const note = {
  id: "note-1",
  projectId,
  content: "Follow up with client",
  createdAt: new Date("2026-06-30T12:00:00.000Z"),
  updatedAt: new Date("2026-06-30T12:00:00.000Z"),
  author: { id: "admin-1", name: "Advisor", email: "advisor@landseed.test" },
};

function buildParams() {
  return { params: Promise.resolve({ projectId }) };
}

function buildJsonRequest(method: string, payload?: { content: string }): Request {
  return {
    url: `https://example.com/api/admin/projects/${projectId}/notes`,
    method,
    headers: { get: () => "application/json" },
    json: jest.fn(() => Promise.resolve(payload)),
  } as unknown as Request;
}

describe("/api/admin/projects/[projectId]/notes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireMinimumRole.mockResolvedValue(true);
  });

  describe("GET", () => {
    it("logs unauthenticated access attempts", async () => {
      mockedAuth.mockResolvedValue(null);
      mockedRequireMinimumRole.mockRejectedValue(new HttpError("unauthenticated", 401));

      const response = await GET(buildJsonRequest("GET"), buildParams());

      expect(response.status).toBe(401);
      expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: "route",
          actorUserId: null,
          routePath: `/api/admin/projects/${projectId}/notes`,
          method: "GET",
          resourceType: "ProjectStaffNote",
          projectId,
        })
      );
    });

    it("logs forbidden access for non-admin users", async () => {
      mockedAuth.mockResolvedValue({ user: { id: "user-1", email: "client@example.com" } });
      mockedRequireMinimumRole.mockRejectedValue(new HttpError("forbidden", 403));

      const response = await GET(buildJsonRequest("GET"), buildParams());

      expect(response.status).toBe(403);
      expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: "user-1",
          reason: "forbidden",
        })
      );
    });

    it("returns notes for admin users", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedListNotesForProject.mockResolvedValue([note]);

      const response = await GET(buildJsonRequest("GET"), buildParams());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ notes: [note] });
      expect(mockedListNotesForProject).toHaveBeenCalledWith(projectId);
    });

    it("returns 404 when project is missing", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedListNotesForProject.mockRejectedValue(
        new ProjectStaffNoteError("Project not found", 404, "PROJECT_NOT_FOUND")
      );

      const response = await GET(buildJsonRequest("GET"), buildParams());
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
    });
  });

  describe("POST", () => {
    it("creates a note for admin users", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedCreateNote.mockResolvedValue(note);

      const response = await POST(buildJsonRequest("POST", { content: "Follow up with client" }), buildParams());
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body).toEqual(note);
      expect(mockedCreateNote).toHaveBeenCalledWith({
        projectId,
        authorUserId: "admin-1",
        content: "Follow up with client",
      });
    });

    it("returns 400 for invalid content", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedCreateNote.mockRejectedValue(
        new ProjectStaffNoteError("Content is required", 400, "INVALID_CONTENT")
      );

      const response = await POST(buildJsonRequest("POST", { content: "   " }), buildParams());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Content is required", code: "INVALID_CONTENT" });
    });
  });
});
