import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  ModificationOverrideError,
  MODIFICATION_OVERRIDE_AUDIT_ACTION,
  POST_ESTIMATE_OVERRIDE_REDIRECT,
  overridePreEstimateModifications,
} from "../modificationOverride";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe("overridePreEstimateModifications", () => {
  const mockedPrisma = prisma as unknown as {
    project: { findUnique: jest.Mock; update: jest.Mock };
  };
  const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws PROJECT_NOT_FOUND when the project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    await expect(
      overridePreEstimateModifications({
        projectId: "missing",
        actorUserId: "admin-1",
        modificationItems: ["Grab bars"],
      })
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND", statusCode: 404 });

    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("throws ESTIMATE_ALREADY_GENERATED with a redirect when a quote already exists", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: "estimate_ready",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [{ id: "quote-1" }],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-1",
        actorUserId: "admin-1",
        modificationItems: ["Ramp"],
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_ALREADY_GENERATED",
      statusCode: 409,
      redirectTo: POST_ESTIMATE_OVERRIDE_REDIRECT,
    });

    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("throws PROJECT_NOT_SUBMITTED when the project is still a draft", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-2",
      status: "draft",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-2",
        actorUserId: "admin-1",
        modificationItems: ["Ramp"],
      })
    ).rejects.toMatchObject({ code: "PROJECT_NOT_SUBMITTED", statusCode: 409 });

    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("rejects an empty modificationItems array", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-3",
      status: "submitted",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-3",
        actorUserId: "admin-1",
        modificationItems: [],
      })
    ).rejects.toMatchObject({ code: "INVALID_MODIFICATION_ITEMS", statusCode: 400 });
  });

  it("rejects unrecognized modification labels", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-4",
      status: "submitted",
      draftData: { modificationItems: ["Grab bars"] },
      quotes: [],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-4",
        actorUserId: "admin-1",
        modificationItems: ["Not a real modification"],
      })
    ).rejects.toMatchObject({ code: "INVALID_MODIFICATION_ITEMS", statusCode: 400 });

    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("updates modificationItems, preserves other draftData, and writes an audit trail", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-5",
      status: "submitted",
      draftData: { modificationItems: ["Grab bars"], address: "123 Main St" },
      quotes: [],
    });
    mockedPrisma.project.update.mockResolvedValue({});

    const result = await overridePreEstimateModifications({
      projectId: "proj-5",
      actorUserId: "admin-1",
      modificationItems: ["Walk-in shower", "Handrails"],
      reason: "Advisory call corrected scope",
      ipAddress: "198.51.100.2",
      userAgent: "jest",
    });

    expect(result).toEqual({
      projectId: "proj-5",
      modificationItems: ["Walk-in shower", "Handrails"],
      modificationCodes: ["WALK_IN_SHOWER", "HANDRAILS"],
    });

    expect(mockedPrisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-5" },
      data: {
        draftData: {
          address: "123 Main St",
          modificationItems: ["Walk-in shower", "Handrails"],
        },
      },
    });

    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: MODIFICATION_OVERRIDE_AUDIT_ACTION,
        outcome: "SUCCESS",
        actorUserId: "admin-1",
        projectId: "proj-5",
        beforeState: {
          modificationItems: ["Grab bars"],
          modificationCodes: ["GRAB_BARS"],
          source: "intake_submission",
        },
        afterState: {
          modificationItems: ["Walk-in shower", "Handrails"],
          modificationCodes: ["WALK_IN_SHOWER", "HANDRAILS"],
          source: "admin_override",
        },
        reason: "Advisory call corrected scope",
        ipAddress: "198.51.100.2",
        userAgent: "jest",
      })
    );
  });

  it("is an instance of ModificationOverrideError for known failures", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    try {
      await overridePreEstimateModifications({
        projectId: "missing",
        actorUserId: "admin-1",
        modificationItems: ["Grab bars"],
      });
      throw new Error("expected overridePreEstimateModifications to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ModificationOverrideError);
    }
  });
});
