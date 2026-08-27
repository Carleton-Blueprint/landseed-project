const mockedUserFindUnique = jest.fn();
const mockedProjectAccessFindUnique = jest.fn();
const mockedProjectAccessFindMany = jest.fn();
const mockedProjectFindMany = jest.fn();
jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockedUserFindUnique(...args),
    },
    projectAccess: {
      findUnique: (...args: unknown[]) => mockedProjectAccessFindUnique(...args),
      findMany: (...args: unknown[]) => mockedProjectAccessFindMany(...args),
    },
    project: {
      findMany: (...args: unknown[]) => mockedProjectFindMany(...args),
    },
  },
}));

import { hasProjectAccess, getAccessibleProjectIds } from "@/backend/auth/projectAccess";

describe("hasProjectAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("ADMIN is granted access without querying ProjectAccess", async () => {
    mockedUserFindUnique.mockResolvedValue({ role: "ADMIN" });
    await expect(hasProjectAccess("admin-1", "project-1")).resolves.toBe(true);
    expect(mockedProjectAccessFindUnique).not.toHaveBeenCalled();
  });

  test("non-admin with no ProjectAccess row is denied", async () => {
    mockedUserFindUnique.mockResolvedValue({ role: "USER" });
    mockedProjectAccessFindUnique.mockResolvedValue(null);
    await expect(hasProjectAccess("user-1", "project-1")).resolves.toBe(false);
  });

  test("non-admin with a role below minimumRole is denied", async () => {
    mockedUserFindUnique.mockResolvedValue({ role: "USER" });
    mockedProjectAccessFindUnique.mockResolvedValue({ role: "VIEWER" });
    await expect(hasProjectAccess("user-1", "project-1", "EDITOR")).resolves.toBe(false);
  });

  test("non-admin with a sufficient role is granted access", async () => {
    mockedUserFindUnique.mockResolvedValue({ role: "USER" });
    mockedProjectAccessFindUnique.mockResolvedValue({ role: "OWNER" });
    await expect(hasProjectAccess("user-1", "project-1", "EDITOR")).resolves.toBe(true);
  });
});

describe("getAccessibleProjectIds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("ADMIN receives every project id via Project.findMany, not ProjectAccess", async () => {
    mockedUserFindUnique.mockResolvedValue({ role: "ADMIN" });
    mockedProjectFindMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    await expect(getAccessibleProjectIds("admin-1")).resolves.toEqual(["p1", "p2"]);
    expect(mockedProjectAccessFindMany).not.toHaveBeenCalled();
  });

  test("non-admin receives only their ProjectAccess project ids", async () => {
    mockedUserFindUnique.mockResolvedValue({ role: "USER" });
    mockedProjectAccessFindMany.mockResolvedValue([{ projectId: "p3" }]);
    await expect(getAccessibleProjectIds("user-1")).resolves.toEqual(["p3"]);
    expect(mockedProjectFindMany).not.toHaveBeenCalled();
  });
});
