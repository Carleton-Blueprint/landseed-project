import { beforeEach, describe, expect, it, jest } from "@jest/globals";
/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@/auth", () => ({
  auth: jest.fn<() => Promise<unknown>>(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    user: {
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
  },
}));

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn<() => Promise<boolean>>(),
}));

jest.mock("@/backend/eligibility/service", () => ({
  evaluateProjectEligibility: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: "198.51.100.2", userAgent: "jest" })),
}));

jest.mock("@/backend/audit/adminAccess", () => ({
  logDeniedAdminAccessAttempt: jest.fn<() => Promise<void>>(() => Promise.resolve(undefined)),
}));

(globalThis as { Response?: { json: (body: unknown, init?: { status?: number }) => { status: number } } }).Response = {
  json: (_body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200 }),
};

const { POST } = require("../route") as {
  POST: (request: Request) => Promise<Response>;
};

const { auth } = require("@/auth") as { auth: jest.Mock };
const { prisma } = require("lib/prisma") as {
  prisma: {
    project: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
  };
};
const { hasProjectAccess } = require("@/backend/auth/projectAccess") as {
  hasProjectAccess: jest.Mock;
};
const { logDeniedAdminAccessAttempt } = require("@/backend/audit/adminAccess") as {
  logDeniedAdminAccessAttempt: jest.Mock;
};
const mockedAuth = auth as jest.MockedFunction<() => Promise<unknown>>;
const mockedLogDeniedAdminAccessAttempt = logDeniedAdminAccessAttempt as jest.MockedFunction<() => Promise<void>>;

function buildJsonRequest(payload: { projectId: string }): Request {
  return {
    url: "https://example.com/api/admin/eligibility/assess",
    method: "POST",
    headers: { get: () => "application/json" },
    json: jest.fn<() => Promise<{ projectId: string }>>(() => Promise.resolve(payload)),
  } as unknown as Request;
}

describe("POST /api/admin/eligibility/assess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs unauthenticated access attempts", async () => {
    mockedAuth.mockImplementation(() => Promise.resolve(null));

    const response = await POST(buildJsonRequest({ projectId: "project-1" }));

    expect(response.status).toBe(401);
    expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "route",
        actorUserId: null,
        routePath: "/api/admin/eligibility/assess",
        method: "POST",
        resourceType: "AdminRoute",
      })
    );
  });

  it("logs forbidden project access attempts", async () => {
    mockedAuth.mockImplementation(() => Promise.resolve({ user: { id: "user-1" } }));
    prisma.project.findUnique.mockImplementation(() => Promise.resolve({ id: "project-1", userId: "owner-1" }));
    hasProjectAccess.mockImplementation(() => Promise.resolve(false));

    const response = await POST(buildJsonRequest({ projectId: "project-1" }));

    expect(response.status).toBe(403);
    expect(mockedLogDeniedAdminAccessAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "data",
        actorUserId: "user-1",
        routePath: "/api/admin/eligibility/assess",
        method: "POST",
        resourceType: "Project",
        resourceId: "project-1",
        projectId: "project-1",
      })
    );
  });
});