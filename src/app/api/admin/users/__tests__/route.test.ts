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
}));

jest.mock("@/backend/auth/requireAdminMfa", () => ({
  MfaSetupRequiredError: class MfaSetupRequiredError extends Error {
    status = 403;
    code = "MFA_SETUP_REQUIRED";
  },
  requireAdminWithMfaEnrolled: jest.fn<() => Promise<boolean>>(),
}));

jest.mock("@/backend/audit/requestContext", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: "198.51.100.2", userAgent: "jest" })),
}));

jest.mock("@/backend/audit/adminAccess", () => ({
  logDeniedAdminAccessAttempt: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
}));

jest.mock("@/backend/services/userRole", () => ({
  listUsersWithRoles: jest.fn(),
}));

(globalThis as { Response?: { json: (body: unknown, init?: { status?: number }) => Response } }).Response = {
  json: (body: unknown, init?: { status?: number }) =>
    ({
      status: init?.status ?? 200,
      json: async () => body,
    }) as Response,
};

const { GET } = require("../route") as {
  GET: (request: Request) => Promise<Response>;
};

const { auth } = require("@/auth") as { auth: jest.Mock };
const { HttpError } = require("@/backend/auth/requireRole") as {
  HttpError: new (message: string, status?: number) => Error & { status: number };
};
const { requireAdminWithMfaEnrolled } = require("@/backend/auth/requireAdminMfa") as {
  requireAdminWithMfaEnrolled: jest.Mock;
};
const { logDeniedAdminAccessAttempt } = require("@/backend/audit/adminAccess") as {
  logDeniedAdminAccessAttempt: jest.Mock;
};
type UserWithRole = { id: string; name: string | null; email: string | null; role: "USER" | "ADMIN" };
const { listUsersWithRoles } = require("@/backend/services/userRole") as {
  listUsersWithRoles: jest.Mock<(...args: unknown[]) => Promise<UserWithRole[]>>;
};

const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedRequireAdminWithMfaEnrolled = requireAdminWithMfaEnrolled as jest.MockedFunction<() => Promise<boolean>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;
const mockedListUsers = listUsersWithRoles as jest.MockedFunction<typeof listUsersWithRoles>;

const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };

function buildRequest(method: string): Request {
  return {
    url: "https://example.com/api/admin/users",
    method,
    headers: { get: () => "application/json" },
    json: jest.fn(() => Promise.resolve(undefined)),
  } as unknown as Request;
}

describe("/api/admin/users", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireAdminWithMfaEnrolled.mockResolvedValue(true);
  });

  it("logs denied access and returns 401 for unauthenticated requests", async () => {
    mockedAuth.mockResolvedValue(null);
    mockedRequireAdminWithMfaEnrolled.mockRejectedValue(new HttpError("unauthenticated", 401));

    const response = await GET(buildRequest("GET"));

    expect(response.status).toBe(401);
    expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "route",
        actorUserId: null,
        routePath: "/api/admin/users",
        method: "GET",
        resourceType: "AdminUserList",
      })
    );
    expect(mockedListUsers).not.toHaveBeenCalled();
  });

  it("returns the user list for an enrolled admin", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedListUsers.mockResolvedValue([
      { id: "user-1", name: "A", email: "a@landseed.test", role: "USER" },
      { id: "admin-1", name: "B", email: "b@landseed.test", role: "ADMIN" },
    ]);

    const response = await GET(buildRequest("GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users).toHaveLength(2);
  });
});
