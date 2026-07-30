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

jest.mock("@/backend/services/mfaReset", () => ({
  MfaResetError: class MfaResetError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode: number, code: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  listAdminsWithMfaStatus: jest.fn(),
  resetAdminMfa: jest.fn(),
}));

(globalThis as { Response?: { json: (body: unknown, init?: { status?: number }) => Response } }).Response = {
  json: (body: unknown, init?: { status?: number }) =>
    ({
      status: init?.status ?? 200,
      json: async () => body,
    }) as Response,
};

const { GET, POST } = require("../route") as {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
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
const { listAdminsWithMfaStatus, resetAdminMfa, MfaResetError } = require("@/backend/services/mfaReset") as {
  listAdminsWithMfaStatus: jest.Mock;
  resetAdminMfa: jest.Mock;
  MfaResetError: new (message: string, statusCode: number, code: string) => Error & {
    statusCode: number;
    code: string;
  };
};

const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedRequireAdminWithMfaEnrolled = requireAdminWithMfaEnrolled as jest.MockedFunction<() => Promise<boolean>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;
const mockedListAdmins = listAdminsWithMfaStatus as jest.MockedFunction<typeof listAdminsWithMfaStatus>;
const mockedResetAdminMfa = resetAdminMfa as jest.MockedFunction<typeof resetAdminMfa>;

const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };

function buildRequest(method: string, body?: Record<string, unknown>): Request {
  return {
    url: "https://example.com/api/admin/mfa/reset",
    method,
    headers: { get: () => "application/json" },
    json: jest.fn(() => Promise.resolve(body)),
  } as unknown as Request;
}

describe("/api/admin/mfa/reset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireAdminWithMfaEnrolled.mockResolvedValue(true);
  });

  describe("GET", () => {
    it("logs denied access and returns 401 for unauthenticated requests", async () => {
      mockedAuth.mockResolvedValue(null);
      mockedRequireAdminWithMfaEnrolled.mockRejectedValue(new HttpError("unauthenticated", 401));

      const response = await GET(buildRequest("GET"));

      expect(response.status).toBe(401);
      expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: "route",
          actorUserId: null,
          routePath: "/api/admin/mfa/reset",
          method: "GET",
          resourceType: "AdminMfaReset",
        })
      );
      expect(mockedListAdmins).not.toHaveBeenCalled();
    });

    it("returns the admin list for an enrolled admin", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedListAdmins.mockResolvedValue([
        { id: "admin-1", email: "advisor@landseed.test", mfaEnabled: true, mfaEnrolledAt: new Date() },
        { id: "admin-2", email: "advisor2@landseed.test", mfaEnabled: false, mfaEnrolledAt: null },
      ]);

      const response = await GET(buildRequest("GET"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.admins).toHaveLength(2);
    });
  });

  describe("POST", () => {
    it("returns 403 with the MFA_SETUP_REQUIRED code when the actor hasn't enrolled MFA", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      const { MfaSetupRequiredError } = require("@/backend/auth/requireAdminMfa");
      mockedRequireAdminWithMfaEnrolled.mockRejectedValue(new MfaSetupRequiredError());

      const response = await POST(buildRequest("POST", { targetUserId: "admin-2" }));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.code).toBe("MFA_SETUP_REQUIRED");
      expect(mockedResetAdminMfa).not.toHaveBeenCalled();
    });

    it("resets the target admin's MFA and returns the result", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedResetAdminMfa.mockResolvedValue({
        id: "admin-2",
        email: "advisor2@landseed.test",
        mfaEnabled: false,
        mfaEnrolledAt: null,
      });

      const response = await POST(buildRequest("POST", { targetUserId: "admin-2" }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        id: "admin-2",
        email: "advisor2@landseed.test",
        mfaEnabled: false,
        mfaEnrolledAt: null,
      });
      expect(mockedResetAdminMfa).toHaveBeenCalledWith({
        targetUserId: "admin-2",
        actorUserId: "admin-1",
        ipAddress: "198.51.100.2",
        userAgent: "jest",
      });
    });

    it("maps MfaResetError to its status code and error code", async () => {
      mockedAuth.mockResolvedValue(adminSession);
      mockedResetAdminMfa.mockRejectedValue(new MfaResetError("Target user not found", 404, "TARGET_NOT_FOUND"));

      const response = await POST(buildRequest("POST", { targetUserId: "missing" }));
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Target user not found", code: "TARGET_NOT_FOUND" });
    });
  });
});
