import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { isAdvisoryTeamEmail, parseAllowedEmails } from "@/backend/auth/requireRole";
import { MFA_RESET_AUDIT_ACTION, listAdminsWithMfaStatus, resetAdminMfa } from "../mfaReset";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/auth/requireRole", () => ({
  isAdvisoryTeamEmail: jest.fn(),
  parseAllowedEmails: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe("resetAdminMfa", () => {
  const mockedPrisma = prisma as unknown as {
    user: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
  const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;
  const mockedIsAdvisoryTeamEmail = isAdvisoryTeamEmail as jest.MockedFunction<typeof isAdvisoryTeamEmail>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws CANNOT_RESET_SELF when targetUserId equals actorUserId", async () => {
    await expect(
      resetAdminMfa({ targetUserId: "admin-1", actorUserId: "admin-1" })
    ).rejects.toMatchObject({ code: "CANNOT_RESET_SELF", statusCode: 400 });

    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("throws TARGET_NOT_FOUND when the target user does not exist", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      resetAdminMfa({ targetUserId: "missing", actorUserId: "admin-1" })
    ).rejects.toMatchObject({ code: "TARGET_NOT_FOUND", statusCode: 404 });

    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("throws TARGET_NOT_AN_ADMIN when the target isn't on the advisory allowlist", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-2",
      email: "client@example.com",
      mfaEnabled: true,
      mfaEnrolledAt: new Date(),
    });
    mockedIsAdvisoryTeamEmail.mockReturnValue(false);

    await expect(
      resetAdminMfa({ targetUserId: "user-2", actorUserId: "admin-1" })
    ).rejects.toMatchObject({ code: "TARGET_NOT_AN_ADMIN", statusCode: 400 });

    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("throws MFA_NOT_ENROLLED when the target has no MFA enrolled", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "admin-2",
      email: "advisor2@landseed.test",
      mfaEnabled: false,
      mfaEnrolledAt: null,
    });
    mockedIsAdvisoryTeamEmail.mockReturnValue(true);

    await expect(
      resetAdminMfa({ targetUserId: "admin-2", actorUserId: "admin-1" })
    ).rejects.toMatchObject({ code: "MFA_NOT_ENROLLED", statusCode: 400 });

    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("clears MFA fields and logs an audit event on success", async () => {
    const enrolledAt = new Date("2026-06-01T00:00:00.000Z");
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "admin-2",
      email: "advisor2@landseed.test",
      mfaEnabled: true,
      mfaEnrolledAt: enrolledAt,
    });
    mockedIsAdvisoryTeamEmail.mockReturnValue(true);
    mockedPrisma.user.update.mockResolvedValue({});

    const result = await resetAdminMfa({
      targetUserId: "admin-2",
      actorUserId: "admin-1",
      ipAddress: "198.51.100.2",
      userAgent: "jest",
    });

    expect(result).toEqual({
      id: "admin-2",
      email: "advisor2@landseed.test",
      mfaEnabled: false,
      mfaEnrolledAt: null,
    });

    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "admin-2" },
      data: { mfaEnabled: false, mfaSecretCiphertext: null, mfaEnrolledAt: null },
    });

    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "SENSITIVE_ACCESS",
        action: MFA_RESET_AUDIT_ACTION,
        outcome: "SUCCESS",
        actorUserId: "admin-1",
        resourceType: "user_mfa",
        resourceId: "admin-2",
        metadata: { targetUserId: "admin-2", targetEmail: "advisor2@landseed.test" },
        beforeState: { mfaEnabled: true, mfaEnrolledAt: enrolledAt },
        afterState: { mfaEnabled: false, mfaEnrolledAt: null },
        ipAddress: "198.51.100.2",
        userAgent: "jest",
      })
    );
  });
});

describe("listAdminsWithMfaStatus", () => {
  const mockedPrisma = prisma as unknown as {
    user: { findMany: jest.Mock };
  };
  const mockedParseAllowedEmails = parseAllowedEmails as jest.MockedFunction<typeof parseAllowedEmails>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns an empty list when the allowlist is empty", async () => {
    mockedParseAllowedEmails.mockReturnValue([]);

    const result = await listAdminsWithMfaStatus();

    expect(result).toEqual([]);
    expect(mockedPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("queries users on the allowlist and returns their MFA status", async () => {
    mockedParseAllowedEmails.mockReturnValue(["admin1@landseed.test", "admin2@landseed.test"]);
    mockedPrisma.user.findMany.mockResolvedValue([
      { id: "admin-1", email: "admin1@landseed.test", mfaEnabled: true, mfaEnrolledAt: new Date() },
      { id: "admin-2", email: "admin2@landseed.test", mfaEnabled: false, mfaEnrolledAt: null },
    ]);

    const result = await listAdminsWithMfaStatus();

    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
      where: { email: { in: ["admin1@landseed.test", "admin2@landseed.test"] } },
      select: { id: true, email: true, mfaEnabled: true, mfaEnrolledAt: true },
      orderBy: { email: "asc" },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "admin-1", email: "admin1@landseed.test", mfaEnabled: true });
  });
});
