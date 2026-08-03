import { requireMinimumRole, hasMinimumRole, isAdvisoryTeamEmail } from "@/backend/auth/requireRole";
import { Session } from "next-auth";

describe("requireRole helper", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.ADVISORY_TEAM_EMAILS;
    process.env.NODE_ENV = "test";
  });

  test("throws 401 when unauthenticated", async () => {
    await expect(requireMinimumRole(null, "ADMIN")).rejects.toMatchObject({ status: 401 });
  });

  test("returns true when user is in the advisory allowlist", async () => {
    process.env.ADVISORY_TEAM_EMAILS = "admin@example.com";
    const session = { user: { id: "u1", email: "admin@example.com" } } as unknown as Session;
    await expect(hasMinimumRole(session, "ADMIN")).resolves.toBe(true);
    await expect(requireMinimumRole(session, "ADMIN")).resolves.toBe(true);
  });

  test("returns false when user is not in the allowlist", async () => {
    const session = { user: { id: "u2", email: "user@example.com" } } as unknown as Session;
    await expect(hasMinimumRole(session, "ADMIN")).resolves.toBe(false);
    await expect(requireMinimumRole(session, "ADMIN")).rejects.toMatchObject({ status: 403 });
  });

  test("USER accepts any authenticated session", async () => {
    const session = { user: { id: "u3", email: "user2@example.com" } } as unknown as Session;
    await expect(hasMinimumRole(session, "USER")).resolves.toBe(true);
    await expect(requireMinimumRole(session, "USER")).resolves.toBe(true);
  });

  describe("isAdvisoryTeamEmail", () => {
    test("matches an allowlisted email case-insensitively", () => {
      process.env.ADVISORY_TEAM_EMAILS = "admin@example.com";
      expect(isAdvisoryTeamEmail("ADMIN@example.com")).toBe(true);
    });

    test("rejects a non-allowlisted email", () => {
      process.env.ADVISORY_TEAM_EMAILS = "admin@example.com";
      expect(isAdvisoryTeamEmail("someone-else@example.com")).toBe(false);
    });

    test("rejects null/undefined", () => {
      process.env.ADVISORY_TEAM_EMAILS = "admin@example.com";
      expect(isAdvisoryTeamEmail(null)).toBe(false);
      expect(isAdvisoryTeamEmail(undefined)).toBe(false);
    });
  });
});

