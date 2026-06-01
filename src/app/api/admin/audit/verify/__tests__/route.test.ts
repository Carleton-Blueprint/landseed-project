import { beforeEach, describe, expect, it, jest } from "@jest/globals";
/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("next/server", () => ({
  NextResponse: class MockNextResponse {
    status: number;

    constructor(_body?: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
    }

    static json(_body: unknown, init?: { status?: number }) {
      return new MockNextResponse(undefined, init);
    }
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

jest.mock("@/backend/audit/adminAccess", () => ({
  logDeniedAdminAccessAttempt: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
}));

jest.mock("@/backend/audit/requestContext", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: "198.51.100.1", userAgent: "jest" })),
}));

jest.mock("@/backend/audit/verify", () => ({
  verifyAuditChain: jest.fn<() => Promise<{ total: number; mismatches: Array<{ id: string; index: number; ok: boolean }> }>>(() =>
    Promise.resolve({ total: 0, mismatches: [] })
  ),
}));

const { GET } = require("../route") as {
  GET: (request: Request) => Promise<{ status: number }>;
};

const { auth } = require("@/auth") as { auth: jest.Mock };
const { requireMinimumRole, HttpError } = require("@/backend/auth/requireRole") as {
  requireMinimumRole: jest.Mock;
  HttpError: new (message: string, status?: number) => Error & { status: number };
};
const { logDeniedAdminAccessAttempt } = require("@/backend/audit/adminAccess") as {
  logDeniedAdminAccessAttempt: jest.Mock;
};
const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedRequireMinimumRole = requireMinimumRole as jest.MockedFunction<() => Promise<boolean>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;

describe("GET /api/admin/audit/verify", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs denied admin access before returning 403", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });
    mockedRequireMinimumRole.mockRejectedValue(new HttpError("forbidden", 403));

    const request = {
      url: "https://example.com/api/admin/audit/verify",
      method: "GET",
      headers: { get: () => null },
    } as unknown as Request;

    const response = await GET(request);

    expect(response.status).toBe(403);
    expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "route",
        actorUserId: "user-1",
        routePath: "/api/admin/audit/verify",
        method: "GET",
        resourceType: "AdminRoute",
      })
    );
  });
});