/**
 * @jest-environment node
 *
 * Regression coverage for the Phase 1/3 admin-gating design: middleware's
 * ADMIN check is driven purely by session.user.role (a JWT-cached snapshot
 * of the DB-backed User.role — see auth.config.ts), with no dependency on
 * any env-var allowlist. ADVISORY_TEAM_EMAILS has been removed from the
 * codebase entirely; this file also asserts a stray value for it has no
 * effect on the outcome.
 */
import type { Session } from "next-auth";

jest.mock("next-auth", () => {
  const auth = jest.fn();
  return {
    __esModule: true,
    default: jest.fn(() => ({ auth })),
  };
});

jest.mock("@/backend/audit/adminAccessDispatch", () => ({
  queueDeniedAdminAccessAudit: jest.fn(),
}));

jest.mock("@/backend/audit/requestContext", () => ({
  getRequestAuditContext: jest.fn(() => ({ ipAddress: "198.51.100.2", userAgent: "jest" })),
}));

import { NextFetchEvent, NextRequest } from "next/server";
import NextAuth from "next-auth";
import { queueDeniedAdminAccessAudit } from "@/backend/audit/adminAccessDispatch";
import { middleware } from "./middleware";

// Same closed-over `auth` jest.fn() that middleware.ts itself received from
// its own `NextAuth(authConfig)` call at module load — see comment in the
// mock factory above for why this works.
const mockAuth = (NextAuth as unknown as jest.Mock)().auth as jest.Mock<Promise<Session | null>, []>;
const mockQueueDeniedAdminAccessAudit = queueDeniedAdminAccessAudit as jest.Mock;

function makeEvent(): NextFetchEvent {
  return { waitUntil: jest.fn() } as unknown as NextFetchEvent;
}

function sessionWithRole(role: "ADMIN" | "USER" | undefined): Session {
  return { user: { id: "u1", role } } as unknown as Session;
}

describe("middleware admin gating", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADVISORY_TEAM_EMAILS;
  });

  test("lets a non-admin path through without checking auth at all", async () => {
    mockAuth.mockResolvedValue(null);
    const request = new NextRequest("http://localhost:3000/dashboard");
    const response = await middleware(request, makeEvent());
    expect(response.status).toBe(200);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  test("allows an admin path through when the cached role is ADMIN", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("ADMIN"));
    const request = new NextRequest("http://localhost:3000/admin");
    const response = await middleware(request, makeEvent());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe("/admin");
    expect(mockQueueDeniedAdminAccessAudit).not.toHaveBeenCalled();
  });

  test("redirects an unauthenticated browser request to sign-in", async () => {
    mockAuth.mockResolvedValue(null);
    const request = new NextRequest("http://localhost:3000/admin", {
      headers: { accept: "text/html" },
    });
    const response = await middleware(request, makeEvent());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/api/auth/signin");
    expect(mockQueueDeniedAdminAccessAudit).toHaveBeenCalledTimes(1);
  });

  test("rejects an unauthenticated JSON/API request with 401", async () => {
    mockAuth.mockResolvedValue(null);
    const request = new NextRequest("http://localhost:3000/api/admin/users");
    const response = await middleware(request, makeEvent());
    expect(response.status).toBe(401);
  });

  test("redirects an authenticated non-admin (cached USER role) browser request to /forbidden", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("USER"));
    const request = new NextRequest("http://localhost:3000/admin", {
      headers: { accept: "text/html" },
    });
    const response = await middleware(request, makeEvent());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/forbidden");
    expect(mockQueueDeniedAdminAccessAudit).toHaveBeenCalledTimes(1);
  });

  test("rejects an authenticated non-admin API request with 403", async () => {
    mockAuth.mockResolvedValue(sessionWithRole("USER"));
    const request = new NextRequest("http://localhost:3000/api/admin/users");
    const response = await middleware(request, makeEvent());
    expect(response.status).toBe(403);
  });

  test("a stray ADVISORY_TEAM_EMAILS env value has no bearing on the outcome", async () => {
    process.env.ADVISORY_TEAM_EMAILS = "u1@example.com";
    mockAuth.mockResolvedValue(sessionWithRole("USER"));
    const request = new NextRequest("http://localhost:3000/admin/users");
    const response = await middleware(request, makeEvent());
    expect(response.status).toBe(403);
  });
});
