import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { USER_ROLE_CHANGE_AUDIT_ACTION, listUsersWithRoles, updateUserRole } from "../userRole";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

describe("updateUserRole", () => {
  const mockedPrisma = prisma as unknown as {
    user: { findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default $transaction implementation: run the callback with a tx proxy
    // backed by the same mocked user methods, matching how the real Prisma
    // client's interactive transaction callback works.
    mockedPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockedPrisma) => unknown) =>
      cb(mockedPrisma)
    );
  });

  it("throws CANNOT_CHANGE_OWN_ROLE when targetUserId equals actorUserId", async () => {
    await expect(
      updateUserRole({ targetUserId: "admin-1", newRole: "USER", actorUserId: "admin-1" })
    ).rejects.toMatchObject({ code: "CANNOT_CHANGE_OWN_ROLE", statusCode: 400 });

    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("throws TARGET_NOT_FOUND when the target user does not exist", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      updateUserRole({ targetUserId: "missing", newRole: "ADMIN", actorUserId: "admin-1" })
    ).rejects.toMatchObject({ code: "TARGET_NOT_FOUND", statusCode: 404 });

    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("no-ops (no audit log) when the target already has the requested role", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-2",
      name: "Jane",
      email: "jane@example.com",
      role: "USER",
    });

    const result = await updateUserRole({ targetUserId: "user-2", newRole: "USER", actorUserId: "admin-1" });

    expect(result).toEqual({ id: "user-2", name: "Jane", email: "jane@example.com", role: "USER" });
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("throws CANNOT_DEMOTE_LAST_ADMIN when the target is the only admin", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "admin-2",
      name: "Last Admin",
      email: "last@landseed.test",
      role: "ADMIN",
    });
    mockedPrisma.user.count.mockResolvedValue(1);

    await expect(
      updateUserRole({ targetUserId: "admin-2", newRole: "USER", actorUserId: "admin-1" })
    ).rejects.toMatchObject({ code: "CANNOT_DEMOTE_LAST_ADMIN", statusCode: 409 });

    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("promotes a user to ADMIN and logs an audit event", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-2",
      name: "Jane",
      email: "jane@example.com",
      role: "USER",
    });
    mockedPrisma.user.update.mockResolvedValue({
      id: "user-2",
      name: "Jane",
      email: "jane@example.com",
      role: "ADMIN",
    });

    const result = await updateUserRole({
      targetUserId: "user-2",
      newRole: "ADMIN",
      actorUserId: "admin-1",
      ipAddress: "198.51.100.2",
      userAgent: "jest",
    });

    expect(result).toEqual({ id: "user-2", name: "Jane", email: "jane@example.com", role: "ADMIN" });
    expect(mockedPrisma.user.count).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { role: "ADMIN" },
      select: { id: true, name: true, email: true, role: true },
    });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "MANUAL_CHANGE",
        action: USER_ROLE_CHANGE_AUDIT_ACTION,
        outcome: "SUCCESS",
        sensitivityLevel: "RESTRICTED",
        actorUserId: "admin-1",
        resourceType: "user_role",
        resourceId: "user-2",
        beforeState: { role: "USER" },
        afterState: { role: "ADMIN" },
        ipAddress: "198.51.100.2",
        userAgent: "jest",
      })
    );
  });

  it("demotes an admin to USER when other admins remain", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "admin-2",
      name: "Second Admin",
      email: "second@landseed.test",
      role: "ADMIN",
    });
    mockedPrisma.user.count.mockResolvedValue(2);
    mockedPrisma.user.update.mockResolvedValue({
      id: "admin-2",
      name: "Second Admin",
      email: "second@landseed.test",
      role: "USER",
    });

    const result = await updateUserRole({ targetUserId: "admin-2", newRole: "USER", actorUserId: "admin-1" });

    expect(result.role).toBe("USER");
    expect(mockedAudit).toHaveBeenCalled();
  });
});

describe("listUsersWithRoles", () => {
  const mockedPrisma = prisma as unknown as { user: { findMany: jest.Mock } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns every user with their role, ordered by email", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      { id: "user-1", name: "A", email: "a@landseed.test", role: "USER" },
      { id: "admin-1", name: "B", email: "b@landseed.test", role: "ADMIN" },
    ]);

    const result = await listUsersWithRoles();

    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { email: "asc" },
    });
    expect(result).toHaveLength(2);
  });
});
