import { Session } from "next-auth";

const mockedFindUnique = jest.fn();
const mockedFindMany = jest.fn();
jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockedFindUnique(...args),
      findMany: (...args: unknown[]) => mockedFindMany(...args),
    },
  },
}));

import { requireMinimumRole, hasMinimumRole, getAdminEmails, parseAllowedEmails } from "@/backend/auth/requireRole";

describe("requireRole helper", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("throws 401 when unauthenticated", async () => {
    await expect(requireMinimumRole(null, "ADMIN")).rejects.toMatchObject({ status: 401 });
  });

  test("returns true when the user's DB role is ADMIN", async () => {
    mockedFindUnique.mockResolvedValue({ role: "ADMIN" });
    const session = { user: { id: "u1", email: "admin@example.com" } } as unknown as Session;
    await expect(hasMinimumRole(session, "ADMIN")).resolves.toBe(true);
    await expect(requireMinimumRole(session, "ADMIN")).resolves.toBe(true);
  });

  test("returns false when the user's DB role is USER", async () => {
    mockedFindUnique.mockResolvedValue({ role: "USER" });
    const session = { user: { id: "u2", email: "user@example.com" } } as unknown as Session;
    await expect(hasMinimumRole(session, "ADMIN")).resolves.toBe(false);
    await expect(requireMinimumRole(session, "ADMIN")).rejects.toMatchObject({ status: 403 });
  });

  test("returns false when no user row is found", async () => {
    mockedFindUnique.mockResolvedValue(null);
    const session = { user: { id: "u4", email: "ghost@example.com" } } as unknown as Session;
    await expect(hasMinimumRole(session, "ADMIN")).resolves.toBe(false);
  });

  test("USER accepts any authenticated session without a DB lookup", async () => {
    const session = { user: { id: "u3", email: "user2@example.com" } } as unknown as Session;
    await expect(hasMinimumRole(session, "USER")).resolves.toBe(true);
    await expect(requireMinimumRole(session, "USER")).resolves.toBe(true);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });
});

describe("getAdminEmails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns emails of every ADMIN user, filtering out nulls", async () => {
    mockedFindMany.mockResolvedValue([{ email: "a@example.com" }, { email: null }, { email: "b@example.com" }]);
    await expect(getAdminEmails()).resolves.toEqual(["a@example.com", "b@example.com"]);
    expect(mockedFindMany).toHaveBeenCalledWith({ where: { role: "ADMIN" }, select: { email: true } });
  });
});

describe("parseAllowedEmails (deprecated, cutover-script-only)", () => {
  beforeEach(() => {
    delete process.env.ADVISORY_TEAM_EMAILS;
  });

  test("parses a comma-separated list, trimmed and lowercased", () => {
    process.env.ADVISORY_TEAM_EMAILS = " Admin@example.com, other@example.com ";
    expect(parseAllowedEmails()).toEqual(["admin@example.com", "other@example.com"]);
  });

  test("returns an empty array when unset", () => {
    expect(parseAllowedEmails()).toEqual([]);
  });
});
