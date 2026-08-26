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
  UserRoleError: class UserRoleError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode: number, code: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  updateUserRole: jest.fn(),
}));

(globalThis as { Response?: { json: (body: unknown, init?: { status?: number }) => Response } }).Response = {
  json: (body: unknown, init?: { status?: number }) =>
    ({
      status: init?.status ?? 200,
      json: async () => body,
    }) as Response,
};

const { PATCH } = require("../route") as {
  PATCH: (request: Request, ctx: { params: Promise<{ userId: string }> }) => Promise<Response>;
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
const { updateUserRole, UserRoleError } = require("@/backend/services/userRole") as {
  updateUserRole: jest.Mock<(...args: unknown[]) => Promise<UserWithRole>>;
  UserRoleError: new (message: string, statusCode: number, code: string) => Error & {
    statusCode: number;
    code: string;
  };
};

const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedRequireAdminWithMfaEnrolled = requireAdminWithMfaEnrolled as jest.MockedFunction<() => Promise<boolean>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;
const mockedUpdateUserRole = updateUserRole as jest.MockedFunction<typeof updateUserRole>;

const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };

function buildRequest(body?: Record<string, unknown>): Request {
  return {
    url: "https://example.com/api/admin/users/user-2/role",
    method: "PATCH",
    headers: { get: () => "application/json" },
    json: jest.fn(() => Promise.resolve(body)),
  } as unknown as Request;
}

function buildParams(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

describe("/api/admin/users/[userId]/role", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireAdminWithMfaEnrolled.mockResolvedValue(true);
  });

  it("logs denied access and returns 401 for unauthenticated requests", async () => {
    mockedAuth.mockResolvedValue(null);
    mockedRequireAdminWithMfaEnrolled.mockRejectedValue(new HttpError("unauthenticated", 401));

    const response = await PATCH(buildRequest({ role: "ADMIN" }), buildParams("user-2"));

    expect(response.status).toBe(401);
    expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "route",
        actorUserId: null,
        routePath: "/api/admin/users/user-2/role",
        method: "PATCH",
        resourceType: "AdminUserRole",
        resourceId: "user-2",
      })
    );
    expect(mockedUpdateUserRole).not.toHaveBeenCalled();
  });

  it("returns 403 with the MFA_SETUP_REQUIRED code when the actor hasn't enrolled MFA", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    const { MfaSetupRequiredError } = require("@/backend/auth/requireAdminMfa");
    mockedRequireAdminWithMfaEnrolled.mockRejectedValue(new MfaSetupRequiredError());

    const response = await PATCH(buildRequest({ role: "ADMIN" }), buildParams("user-2"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("MFA_SETUP_REQUIRED");
    expect(mockedUpdateUserRole).not.toHaveBeenCalled();
  });

  it("returns 400 when role is missing or invalid", async () => {
    mockedAuth.mockResolvedValue(adminSession);

    const response = await PATCH(buildRequest({ role: "SUPERADMIN" }), buildParams("user-2"));

    expect(response.status).toBe(400);
    expect(mockedUpdateUserRole).not.toHaveBeenCalled();
  });

  it("updates the target user's role and returns the result", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedUpdateUserRole.mockResolvedValue({
      id: "user-2",
      name: "Jane",
      email: "jane@landseed.test",
      role: "ADMIN",
    });

    const response = await PATCH(buildRequest({ role: "ADMIN" }), buildParams("user-2"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: "user-2", name: "Jane", email: "jane@landseed.test", role: "ADMIN" });
    expect(mockedUpdateUserRole).toHaveBeenCalledWith({
      targetUserId: "user-2",
      newRole: "ADMIN",
      actorUserId: "admin-1",
      ipAddress: "198.51.100.2",
      userAgent: "jest",
    });
  });

  it("maps UserRoleError to its status code and error code", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedUpdateUserRole.mockRejectedValue(
      new UserRoleError("Can't demote the last remaining admin — promote another user first", 409, "CANNOT_DEMOTE_LAST_ADMIN")
    );

    const response = await PATCH(buildRequest({ role: "USER" }), buildParams("admin-2"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("CANNOT_DEMOTE_LAST_ADMIN");
  });
});
