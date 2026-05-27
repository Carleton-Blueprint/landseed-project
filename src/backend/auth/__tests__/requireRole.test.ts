import { requireMinimumRole, hasMinimumRole, HttpError } from "@/backend/auth/requireRole";

// Mock prisma to control projectAccess lookup
jest.mock("lib/prisma", () => ({
  prisma: {
    projectAccess: {
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from "lib/prisma";

describe("requireRole helper", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.ADVISORY_TEAM_EMAILS;
  });

  test("throws 401 when unauthenticated", async () => {
    await expect(requireMinimumRole(null, "STAFF")).rejects.toMatchObject({ status: 401 });
  });

  test("returns true when user has project access (EDITOR/OWNER)", async () => {
    (prisma.projectAccess.findFirst as jest.Mock).mockResolvedValue({ id: "x" });
    const session = { user: { id: "u1", email: "user@example.com" } } as any;
    await expect(hasMinimumRole(session, "STAFF")).resolves.toBe(true);
    await expect(requireMinimumRole(session, "STAFF")).resolves.toBe(true);
  });

  test("returns false when user has no access and not in allowlist", async () => {
    (prisma.projectAccess.findFirst as jest.Mock).mockResolvedValue(null);
    const session = { user: { id: "u2", email: "user2@example.com" } } as any;
    await expect(hasMinimumRole(session, "STAFF")).resolves.toBe(false);
    await expect(requireMinimumRole(session, "STAFF")).rejects.toMatchObject({ status: 403 });
  });

  test("admin allowlist bypasses projectAccess for ADMIN", async () => {
    process.env.ADVISORY_TEAM_EMAILS = "admin@example.com";
    const session = { user: { id: "u3", email: "admin@example.com" } } as any;
    await expect(hasMinimumRole(session, "ADMIN")).resolves.toBe(true);
    await expect(requireMinimumRole(session, "ADMIN")).resolves.toBe(true);
  });
});
