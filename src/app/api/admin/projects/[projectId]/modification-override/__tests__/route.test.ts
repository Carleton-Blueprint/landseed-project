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

jest.mock("@/backend/services/modificationOverride", () => ({
  ModificationOverrideError: class ModificationOverrideError extends Error {
    statusCode: number;
    code: string;
    redirectTo?: string;

    constructor(message: string, statusCode: number, code: string, redirectTo?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      this.redirectTo = redirectTo;
    }
  },
  overridePreEstimateModifications: jest.fn(),
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
const { requireMinimumRole, HttpError } = require("@/backend/auth/requireRole") as {
  requireMinimumRole: jest.Mock;
  HttpError: new (message: string, status?: number) => Error & { status: number };
};
const { logDeniedAdminAccessAttempt } = require("@/backend/audit/adminAccess") as {
  logDeniedAdminAccessAttempt: jest.Mock;
};
const {
  overridePreEstimateModifications,
  ModificationOverrideError,
} = require("@/backend/services/modificationOverride") as {
  overridePreEstimateModifications: jest.Mock;
  ModificationOverrideError: new (
    message: string,
    statusCode: number,
    code: string,
    redirectTo?: string
  ) => Error & { statusCode: number; code: string; redirectTo?: string };
};

const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedRequireMinimumRole = requireMinimumRole as jest.MockedFunction<() => Promise<boolean>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;
const mockedOverride = overridePreEstimateModifications as jest.MockedFunction<
  typeof overridePreEstimateModifications
>;

const projectId = "project-1";
const adminSession = { user: { id: "admin-1", email: "advisor@landseed.test", role: "ADMIN" } };

function buildParams() {
  return { params: Promise.resolve({ projectId }) };
}

function buildJsonRequest(payload?: Record<string, unknown>): Request {
  return {
    url: `https://example.com/api/admin/projects/${projectId}/modification-override`,
    method: "PUT",
    headers: { get: () => "application/json" },
    json: jest.fn(() => Promise.resolve(payload)),
  } as unknown as Request;
}

describe("/api/admin/projects/[projectId]/modification-override", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireMinimumRole.mockResolvedValue(true);
  });

  it("logs denied admin access and returns 403 for non-admins", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1", email: "client@example.com" } });
    mockedRequireMinimumRole.mockRejectedValue(new HttpError("forbidden", 403));

    const response = await PUT(buildJsonRequest({ modificationItems: ["Grab bars"] }), buildParams());

    expect(response.status).toBe(403);
    expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "route",
        actorUserId: "user-1",
        routePath: `/api/admin/projects/${projectId}/modification-override`,
        method: "PUT",
        resourceType: "ProjectModificationOverride",
        resourceId: projectId,
        projectId,
      })
    );
    expect(mockedOverride).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockedAuth.mockResolvedValue(null);
    mockedRequireMinimumRole.mockRejectedValue(new HttpError("unauthenticated", 401));

    const response = await PUT(buildJsonRequest({ modificationItems: ["Grab bars"] }), buildParams());

    expect(response.status).toBe(401);
    expect(mockedOverride).not.toHaveBeenCalled();
  });

  it("applies the override for admin users", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedOverride.mockResolvedValue({
      projectId,
      modificationItems: ["Walk-in shower"],
      modificationCodes: ["WALK_IN_SHOWER"],
    });

    const response = await PUT(
      buildJsonRequest({ modificationItems: ["Walk-in shower"], reason: "Corrected during intake call" }),
      buildParams()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      projectId,
      modificationItems: ["Walk-in shower"],
      modificationCodes: ["WALK_IN_SHOWER"],
    });
    expect(mockedOverride).toHaveBeenCalledWith({
      projectId,
      actorUserId: "admin-1",
      modificationItems: ["Walk-in shower"],
      reason: "Corrected during intake call",
      ipAddress: "198.51.100.2",
      userAgent: "jest",
    });
  });

  it("returns the FR-4.3 redirect error when an estimate already exists", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedOverride.mockRejectedValue(
      new ModificationOverrideError(
        "An estimate has already been generated for this project. Use the post-estimate modification override instead.",
        409,
        "ESTIMATE_ALREADY_GENERATED",
        "post_estimate_override"
      )
    );

    const response = await PUT(buildJsonRequest({ modificationItems: ["Ramp"] }), buildParams());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error:
        "An estimate has already been generated for this project. Use the post-estimate modification override instead.",
      code: "ESTIMATE_ALREADY_GENERATED",
      redirectTo: "post_estimate_override",
    });
  });

  it("returns 404 when the project does not exist", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedOverride.mockRejectedValue(new ModificationOverrideError("Project not found", 404, "PROJECT_NOT_FOUND"));

    const response = await PUT(buildJsonRequest({ modificationItems: ["Ramp"] }), buildParams());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
  });

  it("returns 400 for invalid modification items", async () => {
    mockedAuth.mockResolvedValue(adminSession);
    mockedOverride.mockRejectedValue(
      new ModificationOverrideError(
        "modificationItems must be a non-empty array of strings",
        400,
        "INVALID_MODIFICATION_ITEMS"
      )
    );

    const response = await PUT(buildJsonRequest({ modificationItems: [] }), buildParams());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "modificationItems must be a non-empty array of strings",
      code: "INVALID_MODIFICATION_ITEMS",
    });
  });
});
