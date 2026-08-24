import { Session } from "next-auth";
import { requireCachedMinimumRole } from "@/backend/auth/requireCachedRole";

function sessionWithRole(role: "ADMIN" | "USER" | undefined): Session {
  return { user: { id: "u1", role } } as unknown as Session;
}

describe("requireCachedMinimumRole", () => {
  test("throws 401 when unauthenticated", () => {
    expect(() => requireCachedMinimumRole(null, "ADMIN")).toThrow(expect.objectContaining({ status: 401 }));
  });

  test("USER requirement accepts any authenticated session regardless of cached role", () => {
    expect(requireCachedMinimumRole(sessionWithRole(undefined), "USER")).toBe(true);
    expect(requireCachedMinimumRole(sessionWithRole("USER"), "USER")).toBe(true);
  });

  test("ADMIN requirement passes when the JWT-cached role is ADMIN", () => {
    expect(requireCachedMinimumRole(sessionWithRole("ADMIN"), "ADMIN")).toBe(true);
  });

  test("ADMIN requirement throws 403 when the JWT-cached role is USER", () => {
    expect(() => requireCachedMinimumRole(sessionWithRole("USER"), "ADMIN")).toThrow(
      expect.objectContaining({ status: 403 })
    );
  });

  test("ADMIN requirement throws 403 when no role was cached on the token", () => {
    expect(() => requireCachedMinimumRole(sessionWithRole(undefined), "ADMIN")).toThrow(
      expect.objectContaining({ status: 403 })
    );
  });

  test("decision depends only on session.user.role — no env var is read", () => {
    process.env.ADVISORY_TEAM_EMAILS = "someone@example.com";
    try {
      expect(() => requireCachedMinimumRole(sessionWithRole("USER"), "ADMIN")).toThrow(
        expect.objectContaining({ status: 403 })
      );
    } finally {
      delete process.env.ADVISORY_TEAM_EMAILS;
    }
  });
});
