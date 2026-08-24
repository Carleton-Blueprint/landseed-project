"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export type GrantApplicationStatus = "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

export interface GrantApplicationStatusHistoryEntry {
  id: string;
  fromStatus: GrantApplicationStatus | null;
  toStatus: GrantApplicationStatus;
  changedAt: string;
  reason: string | null;
  changedByName: string;
}

interface GrantStatusPanelProps {
  projectId: string;
  currentStatus: GrantApplicationStatus;
  history: GrantApplicationStatusHistoryEntry[];
}

const GRANT_STATUS_STYLES: Record<GrantApplicationStatus, { label: string; badge: string }> = {
  DRAFT: { label: "Draft", badge: "border-gray-200 bg-gray-50 text-gray-600" },
  SUBMITTED: { label: "Submitted", badge: "border-blue-200 bg-blue-50 text-blue-700" },
  UNDER_REVIEW: { label: "Under Review", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  APPROVED: { label: "Approved", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "Rejected", badge: "border-red-200 bg-red-50 text-red-600" },
};

/** Mirrors ALLOWED_TRANSITIONS in src/backend/services/grantApplicationLifecycle.ts.
 * Duplicated here (rather than imported) since that module is server-only. */
const ALLOWED_TRANSITIONS: Record<GrantApplicationStatus, GrantApplicationStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

const TRANSITION_BUTTON_STYLES: Record<GrantApplicationStatus, string> = {
  DRAFT: "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  SUBMITTED: "border-blue-300 bg-white text-blue-700 hover:bg-blue-50",
  UNDER_REVIEW: "border-amber-300 bg-white text-amber-700 hover:bg-amber-50",
  APPROVED: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
  REJECTED: "border-red-300 bg-white text-red-700 hover:bg-red-50",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function GrantStatusPanel({ projectId, currentStatus, history }: GrantStatusPanelProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRejection, setPendingRejection] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const nextStatuses = ALLOWED_TRANSITIONS[currentStatus];
  const currentStyle = GRANT_STATUS_STYLES[currentStatus];

  async function handleTransition(toStatus: GrantApplicationStatus, reason?: string) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/project/${projectId}/status-transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus, reason: reason ?? null }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to update grant status");
      }
      setPendingRejection(false);
      setRejectionReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update grant status");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md bg-gray-50 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Grant Application Status</span>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${currentStyle.badge}`}>
          {currentStyle.label}
        </span>
      </div>

      {nextStatuses.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {nextStatuses.map((status) =>
            status === "REJECTED" ? (
              <button
                key={status}
                type="button"
                disabled={submitting}
                onClick={() => setPendingRejection(true)}
                className={`rounded border px-2 py-1 text-[10px] font-medium disabled:opacity-50 ${TRANSITION_BUTTON_STYLES[status]}`}
              >
                Reject
              </button>
            ) : (
              <button
                key={status}
                type="button"
                disabled={submitting}
                onClick={() => handleTransition(status)}
                className={`rounded border px-2 py-1 text-[10px] font-medium disabled:opacity-50 ${TRANSITION_BUTTON_STYLES[status]}`}
              >
                {submitting ? "Saving..." : `Move to ${GRANT_STATUS_STYLES[status].label}`}
              </button>
            )
          )}
        </div>
      )}

      {pendingRejection && (
        <div className="space-y-1.5 rounded border border-red-200 bg-red-50 p-2">
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Reason for rejection (required)..."
            className="min-h-[60px] w-full rounded-md border-red-200 bg-white p-2 text-xs shadow-sm focus:border-red-500 focus:ring-red-500"
            disabled={submitting}
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setPendingRejection(false);
                setRejectionReason("");
              }}
              disabled={submitting}
              className="rounded border bg-white px-2 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleTransition("REJECTED", rejectionReason)}
              disabled={submitting || !rejectionReason.trim()}
              className="rounded border border-red-600 bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Confirm Rejection"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}

      {history.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            className="text-[10px] font-medium text-gray-500 hover:underline"
          >
            {historyOpen ? "Hide" : "Show"} history ({history.length})
          </button>
          {historyOpen && (
            <ul className="mt-1.5 space-y-1 border-t pt-1.5">
              {history.map((entry) => (
                <li key={entry.id} className="text-[10px] text-gray-500">
                  <span className="font-medium text-gray-700">
                    {entry.fromStatus ? `${GRANT_STATUS_STYLES[entry.fromStatus].label} → ` : ""}
                    {GRANT_STATUS_STYLES[entry.toStatus].label}
                  </span>
                  {" — "}
                  {entry.changedByName}, {fmtDateTime(entry.changedAt)}
                  {entry.reason && <span className="italic"> ({entry.reason})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
