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

jest.mock("@/backend/services/adminCustomEmail", () => ({
  AdminCustomEmailError: class AdminCustomEmailError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode: number, code: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  sendAdminCustomEmail: jest.fn(),
}));

(globalThis as { Response?: { json: (body: unknown, init?: { status?: number }) => Response } }).Response = {
  json: (body: unknown, init?: { status?: number }) =>
    ({
      status: init?.status ?? 200,
      json: async () => body,
    }) as Response,
};

const { POST } = require("../route") as {
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
const { sendAdminCustomEmail, AdminCustomEmailError } = require("@/backend/services/adminCustomEmail") as {
  sendAdminCustomEmail: jest.Mock;
  AdminCustomEmailError: new (message: string, statusCode: number, code: string) => Error & {
    statusCode: number;
    code: string;
  };
};

const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedRequireMinimumRole = requireMinimumRole as jest.MockedFunction<() => Promise<boolean>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;
const mockedSendAdminCustomEmail = sendAdminCustomEmail as jest.MockedFunction<typeof sendAdminCustomEmail>;

const projectId = "project-1";
const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };

function buildParams() {
  return { params: Promise.resolve({ projectId }) };
}

function buildJsonRequest(
  method: string,
  payload?: { recipientId?: string; subject?: string; message?: string }
): Request {
  return {
    url: `https://example.com/api/admin/projects/${projectId}/messages`,
    method,
    headers: { get: () => "application/json" },
    json: jest.fn(() => Promise.resolve(payload)),
  } as unknown as Request;
}

describe("/api/admin/projects/[projectId]/messages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireMinimumRole.mockResolvedValue(true);
  });

  it("logs unauthenticated access attempts", async () => {
    mockedAuth.mockResolvedValue(null);
    mockedRequireMinimumRole.mockRejectedValue(new HttpError("unauthenticated", 401));

    const response = await POST(
      buildJsonRequest("POST", { recipientId: "user-1", subject: "Hi", message: "Hello" }),
      buildParams()
    );

    expect(response.status).toBe(401);
    expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "route",
        actorUserId: null,
        routePath: `/api/admin/projects/${projectId}/messages`,
        method: "POST",
        resourceType: "CommunicationHistory",
        projectId,
      })
    );
    expect(mockedSendAdminCustomEmail).not.toHaveBeenCalled();
  });

  it("logs forbidden access for non-admin users", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1", email: "client@example.com" } });
    mockedRequireMinimumRole.mockRejectedValue(new HttpError("forbidden", 403));

    const response = await POST(
      buildJsonRequest("POST", { recipientId: "user-1", subject: "Hi", message: "Hello" }),
      buildParams()
    );

    expect(response.status).toBe(403);
    expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "user-1", reason: "forbidden" })
    );
  });

  it("sends the email and returns confirmation for admin users", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedSendAdminCustomEmail.mockResolvedValue({
      communicationId: "comm-1",
      delivered: true,
      provider: "resend",
      messageId: "msg-1",
    });

    const response = await POST(
      buildJsonRequest("POST", { recipientId: "client-1", subject: "Update", message: "Here is an update." }),
      buildParams()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      communicationId: "comm-1",
      provider: "resend",
      messageId: "msg-1",
    });
    expect(mockedSendAdminCustomEmail).toHaveBeenCalledWith({
      projectId,
      recipientId: "client-1",
      subject: "Update",
      message: "Here is an update.",
      senderId: "admin-1",
    });
  });

  it("returns 502 with a clear error when delivery fails", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedSendAdminCustomEmail.mockResolvedValue({
      communicationId: "comm-2",
      delivered: false,
      deliveryError: "Resend request failed with status 500",
    });

    const response = await POST(
      buildJsonRequest("POST", { recipientId: "client-1", subject: "Update", message: "Here is an update." }),
      buildParams()
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      success: false,
      communicationId: "comm-2",
      error: "Resend request failed with status 500",
    });
  });

  it("returns 400 for invalid input", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedSendAdminCustomEmail.mockRejectedValue(
      new AdminCustomEmailError("Subject is required", 400, "INVALID_SUBJECT")
    );

    const response = await POST(
      buildJsonRequest("POST", { recipientId: "client-1", subject: "", message: "Here is an update." }),
      buildParams()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Subject is required", code: "INVALID_SUBJECT" });
  });

  it("returns 404 when the recipient is not found", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedSendAdminCustomEmail.mockRejectedValue(
      new AdminCustomEmailError("Recipient not found", 404, "RECIPIENT_NOT_FOUND")
    );

    const response = await POST(
      buildJsonRequest("POST", { recipientId: "missing-user", subject: "Hi", message: "Hello" }),
      buildParams()
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Recipient not found", code: "RECIPIENT_NOT_FOUND" });
  });
});
