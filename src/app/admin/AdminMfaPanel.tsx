"use client";

import { useCallback, useState } from "react";
import { Button } from "@/frontend/components/ui/button";

interface AdminMfaStatus {
  id: string;
  email: string;
  mfaEnabled: boolean;
  mfaEnrolledAt: string | null;
}

interface AdminMfaPanelProps {
  currentUserId: string;
}

export function AdminMfaPanel({ currentUserId }: AdminMfaPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [admins, setAdmins] = useState<AdminMfaStatus[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const loadAdmins = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/mfa/reset");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load admins");
        return;
      }
      setAdmins(data.admins);
    } catch {
      setError("Failed to load admins");
    } finally {
      setIsLoading(false);
    }
  }, []);

  function handleToggle() {
    const next = !isOpen;
    setIsOpen(next);
    if (next && admins === null) {
      loadAdmins();
    }
  }

  async function handleReset(targetUserId: string) {
    setResettingId(targetUserId);
    setError(null);
    try {
      const res = await fetch("/api/admin/mfa/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to reset MFA");
        return;
      }
      setAdmins((prev) =>
        prev
          ? prev.map((a) => (a.id === targetUserId ? { ...a, mfaEnabled: false, mfaEnrolledAt: null } : a))
          : prev
      );
    } catch {
      setError("Failed to reset MFA");
    } finally {
      setResettingId(null);
      setConfirmingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pt-6 md:px-8">
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={handleToggle}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-800"
        >
          Admin MFA Enrollment
          <span className="text-xs font-normal text-gray-400">{isOpen ? "Hide" : "Manage"}</span>
        </button>

        {isOpen ? (
          <div className="border-t border-gray-100 px-4 py-4">
            {error ? (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {error}
              </div>
            ) : null}

            {isLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : admins && admins.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {admins.map((admin) => {
                  const isSelf = admin.id === currentUserId;

                  return (
                    <li key={admin.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div>
                        <p className="text-sm text-gray-800">{admin.email}</p>
                        <p className="text-xs text-gray-500">
                          {admin.mfaEnabled
                            ? `Enrolled${
                                admin.mfaEnrolledAt
                                  ? ` on ${new Date(admin.mfaEnrolledAt).toLocaleDateString()}`
                                  : ""
                              }`
                            : "Not enrolled"}
                        </p>
                      </div>

                      {confirmingId === admin.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">Reset MFA for {admin.email}?</span>
                          <Button
                            variant="destructive"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleReset(admin.id)}
                            disabled={resettingId === admin.id}
                          >
                            {resettingId === admin.id ? "Resetting…" : "Confirm"}
                          </Button>
                          <Button
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setConfirmingId(null)}
                            disabled={resettingId === admin.id}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => setConfirmingId(admin.id)}
                          disabled={isSelf || !admin.mfaEnabled}
                          title={isSelf ? "Ask another admin to reset your MFA" : undefined}
                        >
                          Reset MFA
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">No admins found.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
