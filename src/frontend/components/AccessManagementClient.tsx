/**
 * AccessManagementClient — client-side UI for managing project-level role-based access.
 * Primary users (OWNER) can: invite new members by email, update roles, and revoke access.
 * Non-owners see a read-only view of their access entries with no management controls.
 */
"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type AccessMember = {
  role: "OWNER" | "EDITOR" | "VIEWER";
  createdAt: string;
  user: { id: string; name: string | null; email: string | null };
};

export type ProjectWithAccess = {
  id: string;
  address: string;
  userId: string; // primary creator ID
  accessList: AccessMember[];
};

type Props = {
  projects: ProjectWithAccess[];
  currentUserId: string;
};

/* ------------------------------------------------------------------ */
/* Role badge                                                          */
/* ------------------------------------------------------------------ */

const ROLE_STYLES: Record<string, { label: string; className: string }> = {
  OWNER: {
    label: "Owner",
    className:
      "bg-indigo-50 text-indigo-700 border border-indigo-200",
  },
  EDITOR: {
    label: "Editor",
    className:
      "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
  VIEWER: {
    label: "Viewer",
    className:
      "bg-gray-100 text-gray-600 border border-gray-200",
  },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_STYLES[role] ?? ROLE_STYLES.VIEWER;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Avatar initials                                                     */
/* ------------------------------------------------------------------ */

function Avatar({ name, email }: { name: string | null; email: string | null }) {
  const initials = (name ?? email ?? "?")
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-sm font-bold text-white shadow-sm">
      {initials}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Role descriptions (tooltip-like helper text)                        */
/* ------------------------------------------------------------------ */

const ROLE_DESCRIPTIONS: Record<string, string> = {
  OWNER: "Can manage access, view and edit all project data.",
  EDITOR: "Can view and edit project data but cannot manage access.",
  VIEWER: "Can view project data only — no editing or access management.",
};

/* ------------------------------------------------------------------ */
/* Single project panel                                                */
/* ------------------------------------------------------------------ */

function ProjectAccessPanel({
  project,
  currentUserId,
}: {
  project: ProjectWithAccess;
  currentUserId: string;
}) {
  const isOwner = project.accessList.some(
    (m) => m.user.id === currentUserId && m.role === "OWNER"
  );

  // Local optimistic state
  const [members, setMembers] = React.useState<AccessMember[]>(project.accessList);
  const [open, setOpen] = React.useState(true);

  // Invite form state
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"EDITOR" | "VIEWER">("VIEWER");
  const [inviteStatus, setInviteStatus] = React.useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [inviteError, setInviteError] = React.useState<string | null>(null);

  // Per-member action state
  const [memberActions, setMemberActions] = React.useState<
    Record<string, "idle" | "updating" | "revoking">
  >({});

  function setMemberAction(userId: string, state: "idle" | "updating" | "revoking") {
    setMemberActions((prev) => ({ ...prev, [userId]: state }));
  }

  /* Invite */
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);

    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError("Please enter a valid email address.");
      return;
    }

    setInviteStatus("loading");
    try {
      const res = await fetch(`/api/project/${project.id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error ?? "Failed to grant access.");
        setInviteStatus("error");
        return;
      }
      // Optimistically update the list
      const newMember: AccessMember = {
        role: data.access.role,
        createdAt: new Date().toISOString(),
        user: {
          id: data.access.user.id,
          name: data.access.user.name,
          email: data.access.user.email,
        },
      };
      setMembers((prev) => {
        const existing = prev.findIndex((m) => m.user.id === newMember.user.id);
        if (existing >= 0) {
          return prev.map((m, i) => (i === existing ? newMember : m));
        }
        return [...prev, newMember];
      });
      setInviteEmail("");
      setInviteStatus("success");
      setTimeout(() => setInviteStatus("idle"), 2500);
    } catch {
      setInviteError("Network error. Please try again.");
      setInviteStatus("error");
    }
  }

  /* Change role */
  async function handleRoleChange(member: AccessMember, newRole: "OWNER" | "EDITOR" | "VIEWER") {
    if (newRole === member.role) return;
    setMemberAction(member.user.id, "updating");
    try {
      const res = await fetch(`/api/project/${project.id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: member.user.email, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Failed to update role.");
        setMemberAction(member.user.id, "idle");
        return;
      }
      setMembers((prev) =>
        prev.map((m) =>
          m.user.id === member.user.id ? { ...m, role: data.access.role } : m
        )
      );
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setMemberAction(member.user.id, "idle");
    }
  }

  /* Revoke */
  async function handleRevoke(member: AccessMember) {
    if (!confirm(`Remove ${member.user.name ?? member.user.email} from this project?`)) return;
    setMemberAction(member.user.id, "revoking");
    try {
      const res = await fetch(`/api/project/${project.id}/access`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.user.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Failed to revoke access.");
        setMemberAction(member.user.id, "idle");
        return;
      }
      setMembers((prev) => prev.filter((m) => m.user.id !== member.user.id));
    } catch {
      alert("Network error. Please try again.");
      setMemberAction(member.user.id, "idle");
    }
  }

  const sortedMembers = [...members].sort((a, b) => {
    const rank = { OWNER: 0, EDITOR: 1, VIEWER: 2 };
    return (rank[a.role] ?? 3) - (rank[b.role] ?? 3);
  });

  return (
    <div
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md"
      id={`access-panel-${project.id}`}
    >
      {/* Accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-emerald-400 to-teal-500" />

      {/* Header / accordion toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-gray-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
        aria-expanded={open}
        aria-controls={`access-panel-body-${project.id}`}
      >
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-gray-900">
            {project.address}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {members.length} member{members.length !== 1 ? "s" : ""}
            {isOwner && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 border border-indigo-200">
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
                You own this
              </span>
            )}
          </p>
        </div>
        <ChevronIcon open={open} />
      </button>

      {/* Body */}
      {open && (
        <div
          id={`access-panel-body-${project.id}`}
          className="border-t border-gray-100 px-6 pb-6 pt-4 space-y-5"
        >
          {/* Member list */}
          <div className="space-y-2">
            {sortedMembers.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No members yet.</p>
            ) : (
              sortedMembers.map((member) => {
                const isPrimaryCreator = member.user.id === project.userId;
                const actionState = memberActions[member.user.id] ?? "idle";
                const isCurrentUser = member.user.id === currentUserId;

                return (
                  <div
                    key={member.user.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 px-4 py-3 transition-colors hover:bg-gray-50"
                    id={`member-${project.id}-${member.user.id}`}
                  >
                    {/* Avatar */}
                    <Avatar name={member.user.name} email={member.user.email} />

                    {/* Name + email */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {member.user.name ?? "(No name)"}
                        {isCurrentUser && (
                          <span className="ml-1.5 text-xs text-gray-400 font-normal">(you)</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-gray-500">{member.user.email ?? "—"}</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        Added {new Date(member.createdAt).toLocaleDateString("en-CA", {
                          year: "numeric", month: "short", day: "numeric",
                        })}
                      </p>
                    </div>

                    {/* Role controls */}
                    <div className="flex shrink-0 items-center gap-2">
                      {isOwner && !isPrimaryCreator ? (
                        /* Editable role selector */
                        <div className="relative">
                          <select
                            id={`role-select-${project.id}-${member.user.id}`}
                            value={member.role}
                            onChange={(e) =>
                              handleRoleChange(member, e.target.value as "OWNER" | "EDITOR" | "VIEWER")
                            }
                            disabled={actionState === "updating" || actionState === "revoking"}
                            className="appearance-none rounded-md border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 cursor-pointer"
                            aria-label={`Change role for ${member.user.name ?? member.user.email}`}
                            title={ROLE_DESCRIPTIONS[member.role]}
                          >
                            <option value="VIEWER">Viewer</option>
                            <option value="EDITOR">Editor</option>
                            <option value="OWNER">Owner</option>
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                            {actionState === "updating" ? (
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                            ) : (
                              <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                              </svg>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* Read-only badge */
                        <div className="flex items-center gap-1">
                          <RoleBadge role={member.role} />
                          {isPrimaryCreator && (
                            <span title="Primary creator — cannot be removed">
                              <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                              </svg>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Revoke button */}
                      {isOwner && !isPrimaryCreator && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(member)}
                          disabled={actionState === "updating" || actionState === "revoking"}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-gray-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                          aria-label={`Revoke access for ${member.user.name ?? member.user.email}`}
                          title="Revoke access"
                        >
                          {actionState === "revoking" ? (
                            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                          ) : (
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Invite form — only shown to OWNERs */}
          {isOwner && (
            <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
                </svg>
                Invite a caregiver or family member
              </h3>
              <form onSubmit={handleInvite} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor={`invite-email-${project.id}`}
                    className="mb-1 block text-xs font-medium text-gray-700"
                  >
                    Email address
                  </label>
                  <input
                    id={`invite-email-${project.id}`}
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value);
                      setInviteError(null);
                      if (inviteStatus === "error") setInviteStatus("idle");
                    }}
                    placeholder="caregiver@example.com"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 disabled:opacity-60"
                    disabled={inviteStatus === "loading"}
                    autoComplete="email"
                    aria-describedby={inviteError ? `invite-error-${project.id}` : undefined}
                    aria-invalid={!!inviteError}
                  />
                </div>
                <div className="shrink-0">
                  <label
                    htmlFor={`invite-role-${project.id}`}
                    className="mb-1 block text-xs font-medium text-gray-700"
                  >
                    Permission level
                  </label>
                  <div className="relative">
                    <select
                      id={`invite-role-${project.id}`}
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as "EDITOR" | "VIEWER")}
                      disabled={inviteStatus === "loading"}
                      className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 disabled:opacity-60 cursor-pointer"
                      aria-label="Select role for new member"
                    >
                      <option value="VIEWER">Viewer — can view only</option>
                      <option value="EDITOR">Editor — can view & edit</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                      <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </div>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={inviteStatus === "loading" || !inviteEmail.trim()}
                  className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                  size="default"
                  id={`invite-submit-${project.id}`}
                >
                  {inviteStatus === "loading" ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Inviting…
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                      </svg>
                      Send Invite
                    </>
                  )}
                </Button>
              </form>

              {/* Inline feedback */}
              {inviteError && (
                <p
                  id={`invite-error-${project.id}`}
                  role="alert"
                  className="mt-2 flex items-center gap-1.5 text-sm text-red-600"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                  {inviteError}
                </p>
              )}
              {inviteStatus === "success" && (
                <p role="status" className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  Access granted successfully.
                </p>
              )}

              {/* Permission level legend */}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-emerald-100 pt-3">
                {(["VIEWER", "EDITOR"] as const).map((r) => (
                  <p key={r} className="text-[10px] text-gray-500">
                    <span className="font-semibold text-gray-700">{ROLE_STYLES[r].label}:</span>{" "}
                    {ROLE_DESCRIPTIONS[r]}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chevron icon                                                         */
/* ------------------------------------------------------------------ */

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Root component                                                      */
/* ------------------------------------------------------------------ */

export function AccessManagementClient({ projects, currentUserId }: Props) {
  if (projects.length === 0) {
    return (
      <div className="space-y-8">
        {/* Onboarding Intro Card */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50/20 p-6 shadow-sm sm:p-8">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-emerald-100/30 blur-2xl" />
          
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 shadow-sm">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.97 5.97 0 0 0-.75-2.812M12 17.25c1.097 0 2.16-.105 3.19-.307a18.878 18.878 0 0 0-6.38 0A10.362 10.362 0 0 0 12 17.25ZM12 17.25c-.277 0-.55-.008-.82-.025M6 18.72a9.094 9.094 0 0 1-3.741-.479 3 3 0 0 1 4.682-2.72m-.94 3.198-.002.031c0 .225.012.447.037.666A11.944 11.944 0 0 0 12 21c2.17 0 4.207-.576 5.963-1.584A6.062 6.062 0 0 0 18 18.72m-12 0a5.97 5.97 0 0 1 .75-2.812M12 15c-3.18 0-6 1.832-6 5h12c0-3.168-2.82-5-6-5ZM12 12.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" />
              </svg>
            </div>
            
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-gray-900">Secure Caregiver & Family Collaboration</h2>
              <p className="text-sm text-gray-600 leading-relaxed max-w-2xl">
                Landseed lets you securely share your home modification projects, grant assessments, and timelines with caregivers, family members, or occupational therapists.
              </p>
              <div className="pt-2 flex flex-wrap gap-3 text-xs font-semibold text-emerald-700">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Granular roles
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Instant invites
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Audit logs
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Step-by-Step Walkthrough Grid */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 text-xs font-bold">1</div>
            <h3 className="text-sm font-bold text-gray-900">Create an Assessment</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Submit your initial home modification request. This establishes a project dashboard that acts as the collaboration hub.
            </p>
          </div>
          
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 text-xs font-bold">2</div>
            <h3 className="text-sm font-bold text-gray-900">Invite Collaborators</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Enter their email address right here on this page. They will receive a secure portal invitation immediately.
            </p>
          </div>
          
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600 text-xs font-bold">3</div>
            <h3 className="text-sm font-bold text-gray-900">Co-manage Care</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Collaboratively upload home photos, review AI grant discovery matches, and coordinate occupational therapy reports.
            </p>
          </div>
        </div>

        {/* Detailed Role Reference Section */}
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-gray-900">Explore Access Control Roles</h3>
          
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/20 p-4 space-y-2">
              <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-700">Owner</span>
              <p className="text-xs font-medium text-gray-900">Full Administrative Access</p>
              <ul className="text-[11px] text-gray-500 space-y-1 pl-4 list-disc">
                <li>Invite or revoke caregivers</li>
                <li>Edit modification details</li>
                <li>Approve finalized estimates</li>
                <li>Review all grant applications</li>
              </ul>
            </div>

            <div className="rounded-lg border border-emerald-100 bg-emerald-50/20 p-4 space-y-2">
              <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">Editor</span>
              <p className="text-xs font-medium text-gray-900">Active Collaborator</p>
              <ul className="text-[11px] text-gray-500 space-y-1 pl-4 list-disc">
                <li>Upload assessment photos</li>
                <li>Fill out project forms</li>
                <li>View AI grant suggestions</li>
                <li>Cannot manage team members</li>
              </ul>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50/40 p-4 space-y-2">
              <span className="inline-flex items-center rounded-full bg-gray-100 border border-gray-200 px-2.5 py-0.5 text-[10px] font-semibold text-gray-600">Viewer</span>
              <p className="text-xs font-medium text-gray-900">Read-Only Observer</p>
              <ul className="text-[11px] text-gray-500 space-y-1 pl-4 list-disc">
                <li>Monitor timeline progress</li>
                <li>View submitted documents</li>
                <li>Check grant status updates</li>
                <li>No edit or invite privileges</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Empty State Call to Action */}
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <h4 className="mt-3 text-sm font-bold text-gray-900">No active projects discovered</h4>
          <p className="mt-1 text-xs text-gray-500 max-w-sm mx-auto">
            Collaboration requires a home modification assessment project. Start your request intake to invite caregivers.
          </p>
          <Link href="/">
            <Button className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm rounded-lg active:scale-95 transition-all">
              Request Assessment
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {projects.map((project) => (
        <ProjectAccessPanel
          key={project.id}
          project={project}
          currentUserId={currentUserId}
        />
      ))}
    </div>
  );
}
