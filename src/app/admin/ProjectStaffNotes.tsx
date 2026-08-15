"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/frontend/components/ui/button";

interface Note {
  id: string;
  projectId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

export function ProjectStaffNotes({
  projectId,
  currentUserId,
}: {
  projectId: string;
  currentUserId: string;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const fetchNotes = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/admin/projects/${projectId}/notes`);
      if (!res.ok) {
        throw new Error("Failed to load staff notes");
      }
      const data = await res.json();
      setNotes(data.notes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    try {
      setSubmitting(true);
      const res = await fetch(`/api/admin/projects/${projectId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote }),
      });
      
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to add note");
      }
      
      const createdNote = await res.json();
      setNotes([createdNote, ...notes]);
      setNewNote("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateNote = async (noteId: string) => {
    if (!editContent.trim()) return;

    try {
      setSubmitting(true);
      const res = await fetch(`/api/admin/projects/${projectId}/notes/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update note");
      }
      
      const updatedNote = await res.json();
      setNotes(notes.map((n) => (n.id === noteId ? updatedNote : n)));
      setEditingNoteId(null);
      setEditContent("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update note");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm("Are you sure you want to delete this note?")) return;

    try {
      setSubmitting(true);
      const res = await fetch(`/api/admin/projects/${projectId}/notes/${noteId}`, {
        method: "DELETE",
      });
      
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete note");
      }
      
      setNotes(notes.filter((n) => n.id !== noteId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (note: Note) => {
    setEditingNoteId(note.id);
    setEditContent(note.content);
  };

  return (
    <div className="rounded-lg border-2 border-amber-200 bg-amber-50/50 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-amber-900 flex items-center gap-2">
          <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Internal Staff Notes
        </h3>
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 bg-amber-200 px-2.5 py-1 rounded-full">
          Not visible to clients
        </span>
      </div>

      <form onSubmit={handleAddNote} className="space-y-3">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Write a new internal note..."
          className="w-full min-h-[80px] rounded-md border-amber-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm p-3 bg-white"
          disabled={submitting || loading}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!newNote.trim() || submitting || loading}
            className="bg-amber-600 hover:bg-amber-700 text-white border-none"
          >
            {submitting ? "Adding..." : "Add Note"}
          </Button>
        </div>
      </form>

      {loading ? (
        <div className="py-4 text-center text-sm text-amber-700">Loading notes...</div>
      ) : error ? (
        <div className="py-4 text-center text-sm text-red-600">{error}</div>
      ) : notes.length === 0 ? (
        <div className="py-4 text-center text-sm text-amber-700/60 italic">No staff notes yet.</div>
      ) : (
        <div className="space-y-4 pt-2">
          {notes.map((note) => (
            <div key={note.id} className="rounded-md bg-white border border-amber-100 p-4 shadow-sm relative">
              <div className="flex items-start justify-between mb-2">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-gray-900">
                    {note.author.name || note.author.email || "Unknown Author"}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(note.createdAt).toLocaleString()}
                    {note.createdAt !== note.updatedAt && " (edited)"}
                  </span>
                </div>
                {note.author.id === currentUserId && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(note)}
                      className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                      disabled={submitting}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteNote(note.id)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                      disabled={submitting}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {editingNoteId === note.id ? (
                <div className="space-y-3 mt-3">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full min-h-[80px] rounded-md border-amber-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm p-3 bg-gray-50"
                    disabled={submitting}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingNoteId(null);
                        setEditContent("");
                      }}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleUpdateNote(note.id)}
                      disabled={!editContent.trim() || submitting}
                      className="bg-amber-600 hover:bg-amber-700 text-white border-none"
                    >
                      {submitting ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-800 whitespace-pre-wrap">
                  {note.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
