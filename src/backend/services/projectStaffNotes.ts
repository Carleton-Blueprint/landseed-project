/**
 * Internal staff notes attached to projects.
 * Must only be accessed via /api/admin/projects/{projectId}/notes.
 * Never include staffNotes in client-facing selects or exports.
 */

import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";

export const PROJECT_STAFF_NOTE_MAX_CONTENT_LENGTH = 10_000;

export const PROJECT_STAFF_NOTE_AUDIT_ACTIONS = {
  CREATE: "PROJECT_STAFF_NOTE_CREATE",
  UPDATE: "PROJECT_STAFF_NOTE_UPDATE",
  DELETE: "PROJECT_STAFF_NOTE_DELETE",
} as const;

type ProjectStaffNoteErrorCode =
  | "PROJECT_NOT_FOUND"
  | "NOTE_NOT_FOUND"
  | "INVALID_CONTENT";

export class ProjectStaffNoteError extends Error {
  statusCode: number;
  code: ProjectStaffNoteErrorCode;

  constructor(message: string, statusCode: number, code: ProjectStaffNoteErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface SerializedProjectStaffNote {
  id: string;
  projectId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

const authorSelect = {
  id: true,
  name: true,
  email: true,
} as const;

function serializeNote(note: {
  id: string;
  projectId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string | null;
    email: string | null;
  };
}): SerializedProjectStaffNote {
  return {
    id: note.id,
    projectId: note.projectId,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    author: note.author,
  };
}

export function normalizeStaffNoteContent(content: unknown): string {
  if (typeof content !== "string") {
    throw new ProjectStaffNoteError("Content must be a string", 400, "INVALID_CONTENT");
  }

  const normalized = content.trim();
  if (!normalized) {
    throw new ProjectStaffNoteError("Content is required", 400, "INVALID_CONTENT");
  }

  if (normalized.length > PROJECT_STAFF_NOTE_MAX_CONTENT_LENGTH) {
    throw new ProjectStaffNoteError(
      `Content must be at most ${PROJECT_STAFF_NOTE_MAX_CONTENT_LENGTH} characters`,
      400,
      "INVALID_CONTENT"
    );
  }

  return normalized;
}

async function assertProjectExists(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });

  if (!project) {
    throw new ProjectStaffNoteError("Project not found", 404, "PROJECT_NOT_FOUND");
  }
}

async function findNoteForProject(noteId: string, projectId: string) {
  const note = await prisma.projectStaffNote.findFirst({
    where: { id: noteId, projectId },
    include: { author: { select: authorSelect } },
  });

  if (!note) {
    throw new ProjectStaffNoteError("Note not found", 404, "NOTE_NOT_FOUND");
  }

  return note;
}

export async function listNotesForProject(projectId: string): Promise<SerializedProjectStaffNote[]> {
  await assertProjectExists(projectId);

  const notes = await prisma.projectStaffNote.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { author: { select: authorSelect } },
  });

  return notes.map(serializeNote);
}

export async function createNote(input: {
  projectId: string;
  authorUserId: string;
  content: unknown;
}): Promise<SerializedProjectStaffNote> {
  await assertProjectExists(input.projectId);
  const content = normalizeStaffNoteContent(input.content);

  const note = await prisma.projectStaffNote.create({
    data: {
      projectId: input.projectId,
      authorUserId: input.authorUserId,
      content,
    },
    include: { author: { select: authorSelect } },
  });

  const serialized = serializeNote(note);

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: PROJECT_STAFF_NOTE_AUDIT_ACTIONS.CREATE,
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.authorUserId,
    projectId: input.projectId,
    resourceType: "ProjectStaffNote",
    resourceId: note.id,
    afterState: serialized,
  });

  return serialized;
}

export async function updateNote(input: {
  noteId: string;
  projectId: string;
  actorUserId: string;
  content: unknown;
}): Promise<SerializedProjectStaffNote> {
  const existing = await findNoteForProject(input.noteId, input.projectId);
  const content = normalizeStaffNoteContent(input.content);

  const note = await prisma.projectStaffNote.update({
    where: { id: input.noteId },
    data: { content },
    include: { author: { select: authorSelect } },
  });

  const serialized = serializeNote(note);

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: PROJECT_STAFF_NOTE_AUDIT_ACTIONS.UPDATE,
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    resourceType: "ProjectStaffNote",
    resourceId: note.id,
    beforeState: serializeNote(existing),
    afterState: serialized,
  });

  return serialized;
}

export async function deleteNote(input: {
  noteId: string;
  projectId: string;
  actorUserId: string;
}): Promise<void> {
  const existing = await findNoteForProject(input.noteId, input.projectId);

  await prisma.projectStaffNote.delete({
    where: { id: input.noteId },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: PROJECT_STAFF_NOTE_AUDIT_ACTIONS.DELETE,
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    resourceType: "ProjectStaffNote",
    resourceId: input.noteId,
    beforeState: serializeNote(existing),
  });
}
