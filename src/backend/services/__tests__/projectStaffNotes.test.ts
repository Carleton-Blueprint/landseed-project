import {
  PROJECT_STAFF_NOTE_AUDIT_ACTIONS,
  PROJECT_STAFF_NOTE_MAX_CONTENT_LENGTH,
  ProjectStaffNoteError,
  createNote,
  deleteNote,
  listNotesForProject,
  normalizeStaffNoteContent,
  updateNote,
} from "../projectStaffNotes";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
    projectStaffNote: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

describe("projectStaffNotes", () => {
  const mockedPrisma = prisma as unknown as {
    project: { findUnique: jest.Mock };
    projectStaffNote: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  const mockedLogAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

  const author = { id: "user-1", name: "Advisor", email: "advisor@landseed.test" };
  const baseNote = {
    id: "note-1",
    projectId: "project-1",
    authorUserId: "user-1",
    content: "Internal follow-up required",
    createdAt: new Date("2026-06-30T12:00:00.000Z"),
    updatedAt: new Date("2026-06-30T12:00:00.000Z"),
    author,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.project.findUnique.mockResolvedValue({ id: "project-1" });
  });

  describe("normalizeStaffNoteContent", () => {
    it("trims and accepts valid content", () => {
      expect(normalizeStaffNoteContent("  hello  ")).toBe("hello");
    });

    it("rejects empty content", () => {
      expect(() => normalizeStaffNoteContent("   ")).toThrow(ProjectStaffNoteError);
    });

    it("rejects non-string content", () => {
      expect(() => normalizeStaffNoteContent(123)).toThrow(ProjectStaffNoteError);
    });

    it("rejects content over max length", () => {
      expect(() => normalizeStaffNoteContent("a".repeat(PROJECT_STAFF_NOTE_MAX_CONTENT_LENGTH + 1))).toThrow(
        ProjectStaffNoteError
      );
    });
  });

  it("listNotesForProject returns notes newest first", async () => {
    const older = { ...baseNote, id: "note-old", createdAt: new Date("2026-06-29T12:00:00.000Z") };
    const newer = { ...baseNote, id: "note-new", createdAt: new Date("2026-06-30T12:00:00.000Z") };
    mockedPrisma.projectStaffNote.findMany.mockResolvedValue([newer, older]);

    const notes = await listNotesForProject("project-1");

    expect(notes).toHaveLength(2);
    expect(mockedPrisma.projectStaffNote.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  });

  it("listNotesForProject rejects missing project", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);

    await expect(listNotesForProject("missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "PROJECT_NOT_FOUND",
    });
  });

  it("createNote persists note and logs audit event", async () => {
    mockedPrisma.projectStaffNote.create.mockResolvedValue(baseNote);

    const note = await createNote({
      projectId: "project-1",
      authorUserId: "user-1",
      content: "  Internal follow-up required  ",
    });

    expect(note.content).toBe("Internal follow-up required");
    expect(mockedLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "MANUAL_CHANGE",
        action: PROJECT_STAFF_NOTE_AUDIT_ACTIONS.CREATE,
        outcome: "SUCCESS",
        resourceType: "ProjectStaffNote",
        resourceId: "note-1",
        projectId: "project-1",
      })
    );
  });

  it("updateNote updates content and logs before/after state", async () => {
    const updated = { ...baseNote, content: "Updated note", updatedAt: new Date("2026-06-30T13:00:00.000Z") };
    mockedPrisma.projectStaffNote.findFirst.mockResolvedValue(baseNote);
    mockedPrisma.projectStaffNote.update.mockResolvedValue(updated);

    const note = await updateNote({
      noteId: "note-1",
      projectId: "project-1",
      actorUserId: "user-1",
      content: "Updated note",
    });

    expect(note.content).toBe("Updated note");
    expect(mockedLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: PROJECT_STAFF_NOTE_AUDIT_ACTIONS.UPDATE,
        beforeState: expect.objectContaining({ content: "Internal follow-up required" }),
        afterState: expect.objectContaining({ content: "Updated note" }),
      })
    );
  });

  it("updateNote rejects note from another project", async () => {
    mockedPrisma.projectStaffNote.findFirst.mockResolvedValue(null);

    await expect(
      updateNote({
        noteId: "note-1",
        projectId: "project-1",
        actorUserId: "user-1",
        content: "Updated note",
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "NOTE_NOT_FOUND",
    });
  });

  it("deleteNote removes note and logs audit event", async () => {
    mockedPrisma.projectStaffNote.findFirst.mockResolvedValue(baseNote);
    mockedPrisma.projectStaffNote.delete.mockResolvedValue(baseNote);

    await deleteNote({
      noteId: "note-1",
      projectId: "project-1",
      actorUserId: "user-1",
    });

    expect(mockedPrisma.projectStaffNote.delete).toHaveBeenCalledWith({ where: { id: "note-1" } });
    expect(mockedLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: PROJECT_STAFF_NOTE_AUDIT_ACTIONS.DELETE,
        beforeState: expect.objectContaining({ id: "note-1" }),
      })
    );
  });
});
