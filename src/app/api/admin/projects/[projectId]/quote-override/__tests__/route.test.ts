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

jest.mock("@/backend/services/quoteOverride", () => ({
  QuoteOverrideError: class QuoteOverrideError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode: number, code: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  overridePostEstimateQuote: jest.fn(),
}));

(globalThis as { Response?: { json: (body: unknown, init?: { status?: number }) => Response } }).Response = {
  json: (body: unknown, init?: { status?: number }) =>
    ({
      status: init?.status ?? 200,
      json: async () => body,
    }) as Response,
};

const { PUT } = require("../route") as {
  PUT: (
    request: Request,
    context: { params: Promise<{ projectId: string }> }
  ) => Promise<Response>;
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
type QuoteOverrideResult = {
  projectId: string;
  quoteId: string;
  effective: unknown;
  totalChanged: boolean;
};

const {
  overridePostEstimateQuote,
  QuoteOverrideError,
} = require("@/backend/services/quoteOverride") as {
  overridePostEstimateQuote: jest.Mock<(...args: unknown[]) => Promise<QuoteOverrideResult>>;
  QuoteOverrideError: new (
    message: string,
    statusCode: number,
    code: string
  ) => Error & { statusCode: number; code: string };
};

const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedRequireAdminWithMfaEnrolled = requireAdminWithMfaEnrolled as jest.MockedFunction<() => Promise<boolean>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;
const mockedOverride = overridePostEstimateQuote as jest.MockedFunction<typeof overridePostEstimateQuote>;

const projectId = "project-1";
const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };

const validPayload = {
  photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
  pricing: { lineItems: [{ description: "Grab bars", quantity: 2, materialTotal: 40, laborTotal: 60 }], subtotal: 100, total: 120 },
  eligibilityDecision: "ELIGIBLE",
  grantChanges: {},
  reason: "Client requested a manual review",
};

function buildParams() {
  return { params: Promise.resolve({ projectId }) };
}

function buildJsonRequest(payload?: Record<string, unknown>): Request {
  return {
    url: `https://example.com/api/admin/projects/${projectId}/quote-override`,
    method: "PUT",
    headers: { get: () => "application/json" },
    json: jest.fn(() => Promise.resolve(payload)),
  } as unknown as Request;
}

describe("/api/admin/projects/[projectId]/quote-override", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireAdminWithMfaEnrolled.mockResolvedValue(true);
  });

  it("logs denied admin access and returns 403 for non-admins", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1", email: "client@example.com" } });
    mockedRequireAdminWithMfaEnrolled.mockRejectedValue(new HttpError("forbidden", 403));

    const response = await PUT(buildJsonRequest(validPayload), buildParams());

    expect(response.status).toBe(403);
    expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "route",
        actorUserId: "user-1",
        routePath: `/api/admin/projects/${projectId}/quote-override`,
        method: "PUT",
        resourceType: "QuoteOverride",
        resourceId: projectId,
        projectId,
      })
    );
    expect(mockedOverride).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockedAuth.mockResolvedValue(null);
    mockedRequireAdminWithMfaEnrolled.mockRejectedValue(new HttpError("unauthenticated", 401));

    const response = await PUT(buildJsonRequest(validPayload), buildParams());

    expect(response.status).toBe(401);
    expect(mockedOverride).not.toHaveBeenCalled();
  });

  it("applies the override for admin users", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedOverride.mockResolvedValue({
      projectId,
      quoteId: "quote-1",
      effective: { subtotal: 100, total: 120 },
      totalChanged: true,
    });

    const response = await PUT(buildJsonRequest(validPayload), buildParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      projectId,
      quoteId: "quote-1",
      effective: { subtotal: 100, total: 120 },
      totalChanged: true,
    });
    expect(mockedOverride).toHaveBeenCalledWith({
      projectId,
      actorUserId: "admin-1",
      photoModifications: validPayload.photoModifications,
      pricing: validPayload.pricing,
      eligibilityDecision: validPayload.eligibilityDecision,
      grantChanges: validPayload.grantChanges,
      reason: validPayload.reason,
      ipAddress: "198.51.100.2",
      userAgent: "jest",
    });
  });

  it("returns 409 when the project has no quote yet", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedOverride.mockRejectedValue(
      new QuoteOverrideError(
        "No estimate has been generated for this project yet. Use the pre-estimate modification override instead.",
        409,
        "QUOTE_NOT_FOUND"
      )
    );

    const response = await PUT(buildJsonRequest(validPayload), buildParams());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "No estimate has been generated for this project yet. Use the pre-estimate modification override instead.",
      code: "QUOTE_NOT_FOUND",
    });
  });

  it("returns 400 for a missing reason", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedOverride.mockRejectedValue(
      new QuoteOverrideError("reason is required for a post-estimate override", 400, "MISSING_REASON")
    );

    const response = await PUT(buildJsonRequest({ ...validPayload, reason: "" }), buildParams());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "reason is required for a post-estimate override",
      code: "MISSING_REASON",
    });
  });
});
