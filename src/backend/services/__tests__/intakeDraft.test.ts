import { prisma } from "lib/prisma";
import {
  importLegacyDraftIfNeeded,
  ensureShellProject,
  promoteIntakeDraft,
  deleteIntakeDraft,
} from "@/backend/services/intakeDraft";
import { finalizeIntake } from "@/backend/services/finalizeIntake";

jest.mock("lib/prisma", () => ({
  prisma: {
    intakeDraft: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    photo: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/backend/services/finalizeIntake", () => ({
  finalizeIntake: jest.fn(),
}));

const completeIntakeData = {
  name: "Jane Doe",
  email: "jane@example.com",
  phone: "4165550100",
  addressLine1: "123 Main St",
  addressLine2: "",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 1A1",
  ownershipStatus: "owner" as const,
  ownershipOtherDetails: "",
  landlordName: "",
  landlordPhone: "",
  isCaregiver: false,
  seniorName: "",
  relationshipToSenior: "",
  caregiverConsentConfirmed: false,
  clientConsentConfirmed: true,
  modificationItems: ["Grab bars"],
};

describe("intakeDraft service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("importLegacyDraftIfNeeded", () => {
    it("returns existing IntakeDraft without importing", async () => {
      const existing = { id: "draft-1", userId: "user-1" };
      (prisma.intakeDraft.findUnique as jest.Mock).mockResolvedValue(existing);

      const result = await importLegacyDraftIfNeeded("user-1");

      expect(result).toBe(existing);
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
    });

    it("imports legacy Project.draftData when no IntakeDraft exists", async () => {
      (prisma.intakeDraft.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: "legacy-project-1",
        draftData: { name: "Legacy User" },
      });
      (prisma.intakeDraft.create as jest.Mock).mockResolvedValue({
        id: "draft-1",
        userId: "user-1",
        intakeData: { name: "Legacy User" },
        projectId: "legacy-project-1",
      });

      const result = await importLegacyDraftIfNeeded("user-1");

      expect(prisma.intakeDraft.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          intakeData: { name: "Legacy User" },
          projectId: "legacy-project-1",
        },
      });
      expect(result?.projectId).toBe("legacy-project-1");
    });
  });

  describe("ensureShellProject", () => {
    it("creates a shell project when draft has no projectId", async () => {
      (prisma.intakeDraft.upsert as jest.Mock).mockResolvedValue({
        id: "draft-1",
        userId: "user-1",
        projectId: null,
      });
      (prisma.project.create as jest.Mock).mockResolvedValue({ id: "project-1" });
      (prisma.intakeDraft.update as jest.Mock).mockResolvedValue({
        id: "draft-1",
        userId: "user-1",
        projectId: "project-1",
      });

      const result = await ensureShellProject("user-1");

      expect(prisma.project.create).toHaveBeenCalled();
      expect(result.project.id).toBe("project-1");
      expect(result.draft.projectId).toBe("project-1");
    });

    it("reuses existing draft shell project", async () => {
      (prisma.intakeDraft.upsert as jest.Mock).mockResolvedValue({
        id: "draft-1",
        userId: "user-1",
        projectId: "project-1",
      });
      (prisma.project.findUnique as jest.Mock).mockResolvedValue({
        id: "project-1",
        status: "draft",
      });

      const result = await ensureShellProject("user-1");

      expect(prisma.project.create).not.toHaveBeenCalled();
      expect(result.project.id).toBe("project-1");
    });
  });

  describe("promoteIntakeDraft", () => {
    it("returns INCOMPLETE_INTAKE when intake data fails validation", async () => {
      (prisma.intakeDraft.findUnique as jest.Mock).mockResolvedValue({
        id: "draft-1",
        intakeData: { name: "" },
        guidedData: null,
      });

      const result = await promoteIntakeDraft("user-1", { actorUserId: "user-1" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INCOMPLETE_INTAKE");
      }
    });

    it("merges data, finalizes, and deletes the draft", async () => {
      (prisma.intakeDraft.findUnique as jest.Mock).mockResolvedValue({
        id: "draft-1",
        intakeData: completeIntakeData,
        guidedData: { mobilityAssistance: "yes" },
        projectId: null,
      });
      (prisma.intakeDraft.upsert as jest.Mock).mockResolvedValue({
        id: "draft-1",
        projectId: null,
      });
      (prisma.project.create as jest.Mock).mockResolvedValue({ id: "project-1" });
      (prisma.intakeDraft.update as jest.Mock).mockResolvedValue({
        id: "draft-1",
        projectId: "project-1",
      });
      (prisma.project.update as jest.Mock).mockResolvedValue({ id: "project-1" });
      (finalizeIntake as jest.Mock).mockResolvedValue({
        ok: true,
        projectId: "project-1",
        status: "submitted",
        message: "Intake finalized successfully.",
      });
      (prisma.intakeDraft.delete as jest.Mock).mockResolvedValue({ id: "draft-1" });

      const result = await promoteIntakeDraft("user-1", { actorUserId: "user-1" });

      expect(finalizeIntake).toHaveBeenCalledWith({
        projectId: "project-1",
        actorUserId: "user-1",
        ipAddress: undefined,
        userAgent: undefined,
      });
      expect(prisma.intakeDraft.delete).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.projectId).toBe("project-1");
      }
    });
  });

  describe("deleteIntakeDraft", () => {
    it("returns deleted false when no draft exists", async () => {
      (prisma.intakeDraft.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await deleteIntakeDraft("user-1");

      expect(result).toEqual({ deleted: false });
    });

    it("deletes draft and shell project in a transaction", async () => {
      (prisma.intakeDraft.findUnique as jest.Mock).mockResolvedValue({
        id: "draft-1",
        projectId: "project-1",
      });
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) =>
        callback({
          project: {
            findUnique: jest.fn().mockResolvedValue({ status: "draft" }),
            delete: jest.fn(),
          },
          intakeDraft: {
            delete: jest.fn(),
          },
        })
      );

      const result = await deleteIntakeDraft("user-1");

      expect(result).toEqual({ deleted: true });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
