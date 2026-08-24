"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/frontend/components/ui/button";

type SystemRole = "USER" | "ADMIN";

interface UserWithRole {
  id: string;
  name: string | null;
  email: string | null;
  role: SystemRole;
}

interface AdminUsersPanelProps {
  currentUserId: string;
}

export function AdminUsersPanel({ currentUserId }: AdminUsersPanelProps) {
  const [users, setUsers] = useState<UserWithRole[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load users");
        return;
      }
      setUsers(data.users);
    } catch {
      setError("Failed to load users");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function handleRoleChange(targetUserId: string, newRole: SystemRole) {
    setSavingId(targetUserId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${targetUserId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update role");
        return;
      }
      setUsers((prev) => (prev ? prev.map((u) => (u.id === targetUserId ? { ...u, role: newRole } : u)) : prev));
    } catch {
      setError("Failed to update role");
    } finally {
      setSavingId(null);
      setConfirmingId(null);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="px-4 py-3 text-sm font-semibold text-gray-800">Admin Users</div>

      <div className="border-t border-gray-100 px-4 py-4">
        {error ? (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : users && users.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const targetRole: SystemRole = user.role === "ADMIN" ? "USER" : "ADMIN";
              const actionLabel = user.role === "ADMIN" ? "Demote to User" : "Promote to Admin";

              return (
                <li key={user.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm text-gray-800">{user.name ?? user.email ?? user.id}</p>
                    <p className="text-xs text-gray-500">
                      {user.email ?? "no email"} · {user.role}
                    </p>
                  </div>

                  {confirmingId === user.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">
                        {actionLabel} for {user.email ?? user.id}?
                      </span>
                      <Button
                        variant={targetRole === "USER" ? "destructive" : "default"}
                        className="h-7 px-2 text-xs"
                        onClick={() => handleRoleChange(user.id, targetRole)}
                        disabled={savingId === user.id}
                      >
                        {savingId === user.id ? "Saving…" : "Confirm"}
                      </Button>
                      <Button
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => setConfirmingId(null)}
                        disabled={savingId === user.id}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => setConfirmingId(user.id)}
                      disabled={isSelf}
                      title={isSelf ? "Ask another admin to change your role" : undefined}
                    >
                      {actionLabel}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No users found.</p>
        )}
      </div>
    </div>
  );
}
