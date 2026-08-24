import { Session } from "next-auth";

const mockedFindUnique = jest.fn();
jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockedFindUnique(...args),
    },
  },
}));

import { requireAdminWithMfaEnrolled, MfaSetupRequiredError } from "../requireAdminMfa";
import { HttpError } from "@/backend/auth/requireRole";

/** requireAdminWithMfaEnrolled does two findUnique calls: one for role (via
 * requireMinimumRole), one for mfaEnabled — distinguish them by `select`. */
function mockRoleAndMfa(role: "ADMIN" | "USER", mfaEnabled?: boolean) {
  mockedFindUnique.mockImplementation((args: { select?: Record<string, boolean> }) => {
    if (args?.select?.role) return Promise.resolve({ role });
    if (args?.select?.mfaEnabled) return Promise.resolve({ mfaEnabled });
    return Promise.resolve(null);
  });
}

describe("requireAdminWithMfaEnrolled", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("throws 401 when unauthenticated", async () => {
    await expect(requireAdminWithMfaEnrolled(null)).rejects.toMatchObject({ status: 401 });
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  test("throws 403 when the user's DB role is not ADMIN", async () => {
    const session = { user: { id: "u1", email: "user@example.com" } } as unknown as Session;
    mockRoleAndMfa("USER");
    await expect(requireAdminWithMfaEnrolled(session)).rejects.toBeInstanceOf(HttpError);
  });

  test("throws MfaSetupRequiredError when the admin hasn't enrolled MFA", async () => {
    const session = { user: { id: "u1", email: "admin@example.com" } } as unknown as Session;
    mockRoleAndMfa("ADMIN", false);

    await expect(requireAdminWithMfaEnrolled(session)).rejects.toBeInstanceOf(MfaSetupRequiredError);
  });

  test("resolves true for an admin with MFA enrolled", async () => {
    const session = { user: { id: "u1", email: "admin@example.com" } } as unknown as Session;
    mockRoleAndMfa("ADMIN", true);

    await expect(requireAdminWithMfaEnrolled(session)).resolves.toBe(true);
  });
});
