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
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
}));

(globalThis as { Response?: { json: (body: unknown, init?: { status?: number }) => Response } }).Response = {
  json: (body: unknown, init?: { status?: number }) =>
    ({
      status: init?.status ?? 200,
      json: async () => body,
    }) as Response,
};

const { PUT, DELETE } = require("../route") as {
  PUT: (
    request: Request,
    context: { params: Promise<{ projectId: string; noteId: string }> }
  ) => Promise<Response>;
  DELETE: (
    request: Request,
    context: { params: Promise<{ projectId: string; noteId: string }> }
  ) => Promise<Response>;
};

const { auth } = require("@/auth") as { auth: jest.Mock };
const { requireMinimumRole, HttpError } = require("@/backend/auth/requireRole") as {
  requireMinimumRole: jest.Mock;
  HttpError: new (message: string, status?: number) => Error & { status: number };
};
const { logDeniedAdminAccessAttempt } = require("@/backend/audit/adminAccess") as {
  logDeniedAdminAccessAttempt: jest.Mock;
};
const { updateNote, deleteNote, ProjectStaffNoteError } = require("@/backend/services/projectStaffNotes") as {
  updateNote: jest.Mock;
  deleteNote: jest.Mock;
  ProjectStaffNoteError: new (message: string, statusCode: number, code: string) => Error & {
    statusCode: number;
    code: string;
  };
};

const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedRequireMinimumRole = requireMinimumRole as jest.MockedFunction<() => Promise<boolean>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;
const mockedUpdateNote = updateNote as jest.MockedFunction<typeof updateNote>;
const mockedDeleteNote = deleteNote as jest.MockedFunction<typeof deleteNote>;

const projectId = "project-1";
const noteId = "note-1";
const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };
const note = {
  id: noteId,
  projectId,
  content: "Updated follow-up",
  createdAt: new Date("2026-06-30T12:00:00.000Z"),
  updatedAt: new Date("2026-06-30T13:00:00.000Z"),
  author: { id: "admin-1", name: "Advisor", email: "advisor@landseed.test" },
};

function buildParams() {
  return { params: Promise.resolve({ projectId, noteId }) };
}

function buildJsonRequest(method: string, payload?: { content: string }): Request {
  return {
    url: `https://example.com/api/admin/projects/${projectId}/notes/${noteId}`,
    method,
    headers: { get: () => "application/json" },
    json: jest.fn(() => Promise.resolve(payload)),
  } as unknown as Request;
}

describe("/api/admin/projects/[projectId]/notes/[noteId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireMinimumRole.mockResolvedValue(true);
  });

  describe("PUT", () => {
    it("logs denied admin access before returning 403", async () => {
      mockedAuth.mockResolvedValue({ user: { id: "user-1", email: "client@example.com" } });
      mockedRequireMinimumRole.mockRejectedValue(new HttpError("forbidden", 403));

      const response = await PUT(buildJsonRequest("PUT", { content: "Updated follow-up" }), buildParams());

      expect(response.status).toBe(403);
      expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: "route",
          actorUserId: "user-1",
          routePath: `/api/admin/projects/${projectId}/notes/${noteId}`,
          method: "PUT",
          resourceType: "ProjectStaffNote",
          resourceId: noteId,
          projectId,
        })
      );
    });

    it("updates a note for admin users", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedUpdateNote.mockResolvedValue(note);

      const response = await PUT(buildJsonRequest("PUT", { content: "Updated follow-up" }), buildParams());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(note);
      expect(mockedUpdateNote).toHaveBeenCalledWith({
        noteId,
        projectId,
        actorUserId: "admin-1",
        content: "Updated follow-up",
      });
    });

    it("returns 404 when note is missing", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedUpdateNote.mockRejectedValue(new ProjectStaffNoteError("Note not found", 404, "NOTE_NOT_FOUND"));

      const response = await PUT(buildJsonRequest("PUT", { content: "Updated follow-up" }), buildParams());
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Note not found", code: "NOTE_NOT_FOUND" });
    });
  });

  describe("DELETE", () => {
    it("deletes a note for admin users", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedDeleteNote.mockResolvedValue(undefined);

      const response = await DELETE(buildJsonRequest("DELETE"), buildParams());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ success: true });
      expect(mockedDeleteNote).toHaveBeenCalledWith({
        noteId,
        projectId,
        actorUserId: "admin-1",
      });
    });

    it("returns 404 when note is missing", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedDeleteNote.mockRejectedValue(new ProjectStaffNoteError("Note not found", 404, "NOTE_NOT_FOUND"));

      const response = await DELETE(buildJsonRequest("DELETE"), buildParams());
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Note not found", code: "NOTE_NOT_FOUND" });
    });
  });
});
