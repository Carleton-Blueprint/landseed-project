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

describe("requireAdminWithMfaEnrolled", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADVISORY_TEAM_EMAILS = "admin@example.com";
  });

  test("throws 401 when unauthenticated", async () => {
    await expect(requireAdminWithMfaEnrolled(null)).rejects.toMatchObject({ status: 401 });
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  test("throws 403 when not on the advisory allowlist", async () => {
    const session = { user: { id: "u1", email: "user@example.com" } } as unknown as Session;
    await expect(requireAdminWithMfaEnrolled(session)).rejects.toBeInstanceOf(HttpError);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  test("throws MfaSetupRequiredError when the admin hasn't enrolled MFA", async () => {
    const session = { user: { id: "u1", email: "admin@example.com" } } as unknown as Session;
    mockedFindUnique.mockResolvedValue({ mfaEnabled: false });

    await expect(requireAdminWithMfaEnrolled(session)).rejects.toBeInstanceOf(MfaSetupRequiredError);
  });

  test("resolves true for an admin with MFA enrolled", async () => {
    const session = { user: { id: "u1", email: "admin@example.com" } } as unknown as Session;
    mockedFindUnique.mockResolvedValue({ mfaEnabled: true });

    await expect(requireAdminWithMfaEnrolled(session)).resolves.toBe(true);
  });
});
