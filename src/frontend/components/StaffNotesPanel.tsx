"use client";

import React, { useState, useEffect, useCallback } from "react";
import { LockIcon, TrashIcon, Edit2Icon, CheckIcon, XIcon, UserCircleIcon, AlertTriangleIcon } from "lucide-react";
import { useSession } from "next-auth/react";

type StaffNote = {
  id: string;
  projectId: string;
  authorUserId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: {
    name: string | null;
    email: string | null;
  };
};

type StaffNotesPanelProps = {
  projectId: string;
};

export function StaffNotesPanel({ projectId }: StaffNotesPanelProps) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const [notes, setNotes] = useState<StaffNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const [newNote, setNewNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/notes`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setIsSubmitting(true);
    
    const res = await fetch(`/api/admin/projects/${projectId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newNote }),
    });
    
    if (res.ok) {
      setNewNote("");
      loadNotes();
    }
    setIsSubmitting(false);
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm("Are you sure you want to delete this internal note?")) return;
    
    const res = await fetch(`/api/admin/projects/${projectId}/notes/${noteId}`, { method: "DELETE" });
    if (res.ok) loadNotes();
  };

  const handleSaveEdit = async (noteId: string) => {
    if (!editContent.trim()) return;
    
    const res = await fetch(`/api/admin/projects/${projectId}/notes/${noteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent }),
    });
    
    if (res.ok) {
      setEditingNoteId(null);
      loadNotes();
    }
  };

  const startEdit = (note: StaffNote) => {
    setEditingNoteId(note.id);
    setEditContent(note.content);
  };

  if (error) return <div className="p-4 text-red-500 bg-red-50 rounded-md border border-red-200">Failed to load staff notes.</div>;

  return (
    <div className="mt-6 overflow-hidden rounded-lg border bg-amber-50 shadow-sm">
      <div className="flex items-center justify-between border-b border-amber-200 bg-amber-100/50 px-5 py-3">
        <h4 className="flex items-center gap-2 text-sm font-bold text-amber-900">
          <LockIcon size={16} className="text-amber-700" />
          Internal Staff Notes
        </h4>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-700">
          <AlertTriangleIcon size={12} />
          Not visible to clients
        </span>
      </div>

      <div className="space-y-6 p-5">
        <div className="flex flex-col gap-2">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add an internal note about this project..."
            className="min-h-[80px] w-full rounded-md border-amber-200 bg-white p-3 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
            disabled={isSubmitting}
          />
          <div className="flex justify-end">
            <button
              onClick={handleAddNote}
              disabled={isSubmitting || !newNote.trim()}
              className="inline-flex items-center rounded-md border border-transparent bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : "Add Note"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {isLoading ? (
            <div className="flex animate-pulse space-x-4">
              <div className="flex-1 space-y-4 py-1">
                <div className="h-4 w-3/4 rounded bg-amber-200"></div>
                <div className="space-y-2">
                  <div className="h-4 rounded bg-amber-200"></div>
                  <div className="h-4 w-5/6 rounded bg-amber-200"></div>
                </div>
              </div>
            </div>
          ) : notes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-amber-300 py-6 text-center text-sm italic text-amber-700/60">
              No staff notes yet.
            </div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="group relative rounded-md border border-amber-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <UserCircleIcon size={16} className="text-amber-500" />
                    <span className="text-sm font-semibold text-gray-900">
                      {note.author.name || note.author.email || "Unknown"}
                    </span>
                    <span className="text-xs text-gray-400">
                      • {new Date(note.createdAt).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', year: 'numeric',
                        hour: 'numeric', minute: '2-digit'
                      })}
                    </span>
                    {note.createdAt !== note.updatedAt && (
                      <span className="text-[10px] italic text-gray-400">(edited)</span>
                    )}
                  </div>
                  {currentUserId === note.authorUserId && editingNoteId !== note.id && (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => startEdit(note)}
                        className="rounded p-1 text-gray-400 transition-colors hover:text-amber-600"
                        title="Edit"
                      >
                        <Edit2Icon size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="rounded p-1 text-gray-400 transition-colors hover:text-red-600"
                        title="Delete"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {editingNoteId === note.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full rounded-md border-amber-300 bg-amber-50/50 p-2 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
                      rows={3}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingNoteId(null)}
                        className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50"
                      >
                        <XIcon size={12} /> Cancel
                      </button>
                      <button
                        onClick={() => handleSaveEdit(note.id)}
                        disabled={!editContent.trim() || editContent === note.content}
                        className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
                      >
                        <CheckIcon size={12} /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-sm text-gray-700">{note.content}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
