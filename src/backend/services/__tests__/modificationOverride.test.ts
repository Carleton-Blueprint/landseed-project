import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { queueEligibilityEvaluation } from "@/backend/eligibility/triggers";
import {
  ModificationOverrideError,
  MODIFICATION_OVERRIDE_AUDIT_ACTION,
  overridePreEstimateModifications,
} from "../modificationOverride";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/eligibility/triggers", () => ({
  queueEligibilityEvaluation: jest.fn().mockResolvedValue(undefined),
}));

const mockedTxProjectFindUnique = jest.fn();
const mockedTxPhotoUpdate = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
    photo: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        project: { findUnique: mockedTxProjectFindUnique },
        photo: { update: mockedTxPhotoUpdate },
      })
    ),
  },
}));

describe("overridePreEstimateModifications", () => {
  const mockedPrisma = prisma as unknown as {
    project: { findUnique: jest.Mock };
    photo: { findMany: jest.Mock };
  };
  const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;
  const mockedQueueEligibility = queueEligibilityEvaluation as jest.MockedFunction<
    typeof queueEligibilityEvaluation
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedTxProjectFindUnique.mockReset();
    mockedTxPhotoUpdate.mockReset();
  });

  it("throws PROJECT_NOT_FOUND when the project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    await expect(
      overridePreEstimateModifications({
        projectId: "missing",
        actorUserId: "admin-1",
        photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
      })
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND", statusCode: 404 });

    expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
  });

  it("throws ESTIMATE_ALREADY_GENERATED when a quote already exists", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-1",
      status: "ESTIMATE_READY",
      quotes: [{ id: "quote-1" }],
      photos: [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-1",
        actorUserId: "admin-1",
        photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["STAIR_LIFT"] }],
      })
    ).rejects.toMatchObject({ code: "ESTIMATE_ALREADY_GENERATED", statusCode: 409 });

    expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
  });

  it("throws PROJECT_NOT_SUBMITTED when the project is still a draft", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-2",
      status: "DRAFT",
      quotes: [],
      photos: [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-2",
        actorUserId: "admin-1",
        photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["STAIR_LIFT"] }],
      })
    ).rejects.toMatchObject({ code: "PROJECT_NOT_SUBMITTED", statusCode: 409 });

    expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
  });

  it("rejects an empty photoModifications array", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-3",
      status: "SUBMITTED",
      quotes: [],
      photos: [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-3",
        actorUserId: "admin-1",
        photoModifications: [],
      })
    ).rejects.toMatchObject({ code: "INVALID_PHOTO_MODIFICATIONS", statusCode: 400 });
  });

  it("rejects a photoId that doesn't belong to the project", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-4",
      status: "SUBMITTED",
      quotes: [],
      photos: [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-4",
        actorUserId: "admin-1",
        photoModifications: [{ photoId: "photo-other", declaredModificationCodes: ["STAIR_LIFT"] }],
      })
    ).rejects.toMatchObject({ code: "INVALID_PHOTO_MODIFICATIONS", statusCode: 400 });

    expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
  });

  it("rejects duplicate photoIds in the same request", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-4b",
      status: "SUBMITTED",
      quotes: [],
      photos: [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-4b",
        actorUserId: "admin-1",
        photoModifications: [
          { photoId: "photo-1", declaredModificationCodes: ["STAIR_LIFT"] },
          { photoId: "photo-1", declaredModificationCodes: ["HANDRAILS"] },
        ],
      })
    ).rejects.toMatchObject({ code: "INVALID_PHOTO_MODIFICATIONS", statusCode: 400 });
  });

  it("rejects unrecognized modification codes", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-5",
      status: "SUBMITTED",
      quotes: [],
      photos: [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-5",
        actorUserId: "admin-1",
        photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["Not a real code"] }],
      })
    ).rejects.toMatchObject({ code: "INVALID_PHOTO_MODIFICATIONS", statusCode: 400 });

    expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
  });

  it("rejects a photo entry with no modification codes", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-5b",
      status: "SUBMITTED",
      quotes: [],
      photos: [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-5b",
        actorUserId: "admin-1",
        photoModifications: [{ photoId: "photo-1", declaredModificationCodes: [] }],
      })
    ).rejects.toMatchObject({ code: "INVALID_PHOTO_MODIFICATIONS", statusCode: 400 });

    expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
  });

  it("rejects an override attempt when the project has no photos at all", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-5c",
      status: "SUBMITTED",
      quotes: [],
      photos: [],
    });

    await expect(
      overridePreEstimateModifications({
        projectId: "proj-5c",
        actorUserId: "admin-1",
        photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
      })
    ).rejects.toMatchObject({ code: "INVALID_PHOTO_MODIFICATIONS", statusCode: 400 });

    expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
  });

  it("updates photo tags, writes a per-photo audit trail, and queues re-evaluation", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue({
      id: "proj-6",
      status: "SUBMITTED",
      quotes: [],
      photos: [
        { id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] },
        { id: "photo-2", declaredModificationCodes: [] },
      ],
    });
    mockedTxProjectFindUnique.mockResolvedValue({ status: "SUBMITTED", quotes: [] });
    mockedTxPhotoUpdate.mockResolvedValue({});
    mockedPrisma.photo.findMany.mockResolvedValue([
      { declaredModificationCodes: ["WALK_IN_SHOWER"] },
      { declaredModificationCodes: ["HANDRAILS"] },
    ]);

    const result = await overridePreEstimateModifications({
      projectId: "proj-6",
      actorUserId: "admin-1",
      photoModifications: [
        { photoId: "photo-1", declaredModificationCodes: ["WALK_IN_SHOWER"] },
        { photoId: "photo-2", declaredModificationCodes: ["HANDRAILS"] },
      ],
      reason: "Advisory call corrected scope",
      ipAddress: "198.51.100.2",
      userAgent: "jest",
    });

    expect(result).toEqual({
      projectId: "proj-6",
      photos: [
        { photoId: "photo-1", declaredModificationCodes: ["WALK_IN_SHOWER"] },
        { photoId: "photo-2", declaredModificationCodes: ["HANDRAILS"] },
      ],
      modificationCodes: ["WALK_IN_SHOWER", "HANDRAILS"],
    });

    expect(mockedTxPhotoUpdate).toHaveBeenCalledWith({
      where: { id: "photo-1" },
      data: { declaredModificationCodes: ["WALK_IN_SHOWER"] },
    });
    expect(mockedTxPhotoUpdate).toHaveBeenCalledWith({
      where: { id: "photo-2" },
      data: { declaredModificationCodes: ["HANDRAILS"] },
    });

    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: MODIFICATION_OVERRIDE_AUDIT_ACTION,
        outcome: "SUCCESS",
        actorUserId: "admin-1",
        projectId: "proj-6",
        beforeState: {
          photos: [
            { photoId: "photo-1", declaredModificationCodes: ["GRAB_BARS"] },
            { photoId: "photo-2", declaredModificationCodes: [] },
          ],
          modificationCodes: ["GRAB_BARS"],
          source: "intake_submission",
        },
        afterState: {
          photos: [
            { photoId: "photo-1", declaredModificationCodes: ["WALK_IN_SHOWER"] },
            { photoId: "photo-2", declaredModificationCodes: ["HANDRAILS"] },
          ],
          modificationCodes: ["WALK_IN_SHOWER", "HANDRAILS"],
          source: "admin_override",
        },
        reason: "Advisory call corrected scope",
        ipAddress: "198.51.100.2",
        userAgent: "jest",
      })
    );

    expect(mockedQueueEligibility).toHaveBeenCalledWith("proj-6");
  });

  it("is an instance of ModificationOverrideError for known failures", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    try {
      await overridePreEstimateModifications({
        projectId: "missing",
        actorUserId: "admin-1",
        photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
      });
      throw new Error("expected overridePreEstimateModifications to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ModificationOverrideError);
    }
  });

  describe("race with the delayed estimate-generation worker", () => {
    it("re-checks and throws ESTIMATE_ALREADY_GENERATED when the worker's quote lands between read and write", async () => {
      mockedPrisma.project.findUnique
        .mockResolvedValueOnce({
          id: "proj-7",
          status: "SUBMITTED",
          quotes: [],
          photos: [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
        })
        .mockResolvedValueOnce({
          status: "ESTIMATE_READY",
          quotes: [{ id: "quote-raced-in" }],
        });
      mockedTxProjectFindUnique.mockResolvedValue({
        status: "ESTIMATE_READY",
        quotes: [{ id: "quote-raced-in" }],
      });

      await expect(
        overridePreEstimateModifications({
          projectId: "proj-7",
          actorUserId: "admin-1",
          photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["STAIR_LIFT"] }],
        })
      ).rejects.toMatchObject({ code: "ESTIMATE_ALREADY_GENERATED", statusCode: 409 });

      expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
      expect(mockedAudit).not.toHaveBeenCalled();
      expect(mockedQueueEligibility).not.toHaveBeenCalled();
    });

    it("re-checks and throws PROJECT_NOT_SUBMITTED when the project left submitted state without a quote", async () => {
      mockedPrisma.project.findUnique
        .mockResolvedValueOnce({
          id: "proj-8",
          status: "SUBMITTED",
          quotes: [],
          photos: [{ id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }],
        })
        .mockResolvedValueOnce({ status: "DRAFT", quotes: [] });
      mockedTxProjectFindUnique.mockResolvedValue({ status: "DRAFT", quotes: [] });

      await expect(
        overridePreEstimateModifications({
          projectId: "proj-8",
          actorUserId: "admin-1",
          photoModifications: [{ photoId: "photo-1", declaredModificationCodes: ["STAIR_LIFT"] }],
        })
      ).rejects.toMatchObject({ code: "PROJECT_NOT_SUBMITTED", statusCode: 409 });

      expect(mockedTxPhotoUpdate).not.toHaveBeenCalled();
      expect(mockedAudit).not.toHaveBeenCalled();
      expect(mockedQueueEligibility).not.toHaveBeenCalled();
    });
  });
});
