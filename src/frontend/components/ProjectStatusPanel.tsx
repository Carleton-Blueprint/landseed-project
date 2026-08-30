"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export type ProjectStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "ESTIMATE_READY"
  | "ESTIMATE_EXPIRED"
  | "ESTIMATE_ACCEPTED"
  | "ESTIMATE_DECLINED"
  | "APPROVED"
  | "REJECTED"
  | "WORK_SCHEDULED"
  | "WORK_IN_PROGRESS"
  | "WORK_ON_HOLD"
  | "WORK_COMPLETED"
  | "WORK_CANCELLED";

export interface ProjectStatusHistoryEntry {
  id: string;
  fromStatus: ProjectStatus | null;
  toStatus: ProjectStatus;
  changedAt: string;
  reason: string | null;
  changedByName: string;
}

interface ProjectStatusPanelProps {
  projectId: string;
  currentStatus: ProjectStatus;
  history: ProjectStatusHistoryEntry[];
}

const PROJECT_STATUS_STYLES: Record<ProjectStatus, { label: string; badge: string }> = {
  DRAFT: { label: "Draft", badge: "border-gray-200 bg-gray-50 text-gray-600" },
  SUBMITTED: { label: "Submitted", badge: "border-blue-200 bg-blue-50 text-blue-700" },
  ESTIMATE_READY: { label: "Estimate Ready", badge: "border-violet-200 bg-violet-50 text-violet-700" },
  ESTIMATE_EXPIRED: { label: "Estimate Expired", badge: "border-orange-200 bg-orange-50 text-orange-700" },
  ESTIMATE_ACCEPTED: { label: "Estimate Accepted", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  ESTIMATE_DECLINED: { label: "Estimate Declined", badge: "border-red-200 bg-red-50 text-red-600" },
  APPROVED: { label: "Approved", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "Rejected", badge: "border-red-200 bg-red-50 text-red-600" },
  WORK_SCHEDULED: { label: "Work Scheduled", badge: "border-sky-200 bg-sky-50 text-sky-700" },
  WORK_IN_PROGRESS: { label: "Work In Progress", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  WORK_ON_HOLD: { label: "Work On Hold", badge: "border-orange-200 bg-orange-50 text-orange-700" },
  WORK_COMPLETED: { label: "Work Completed", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  WORK_CANCELLED: { label: "Work Cancelled", badge: "border-red-200 bg-red-50 text-red-600" },
};

/** Mirrors ALLOWED_TRANSITIONS in src/backend/services/projectStatusLifecycle.ts.
 * Duplicated here (rather than imported) since that module is server-only.
 * Only ESTIMATE_ACCEPTED has outgoing transitions through this panel — every
 * other status change (DRAFT→SUBMITTED, the estimate sub-states) is driven by
 * its own service, not by an admin action here. The WORK_* statuses have no
 * driver at all currently — they were previously set by inbound BuilderTrend
 * callbacks, which have been removed. */
const ALLOWED_TRANSITIONS: Partial<Record<ProjectStatus, ProjectStatus[]>> = {
  ESTIMATE_ACCEPTED: ["APPROVED", "REJECTED"],
};

const TRANSITION_BUTTON_STYLES: Record<"APPROVED" | "REJECTED", string> = {
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

export function ProjectStatusPanel({ projectId, currentStatus, history }: ProjectStatusPanelProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRejection, setPendingRejection] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const nextStatuses = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  const currentStyle = PROJECT_STATUS_STYLES[currentStatus];

  async function handleTransition(toStatus: "APPROVED" | "REJECTED", reason?: string) {
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
        throw new Error(body?.error ?? "Failed to update project status");
      }
      setPendingRejection(false);
      setRejectionReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project status");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md bg-gray-50 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Project Status</span>
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
                className={`rounded border px-2 py-1 text-[10px] font-medium disabled:opacity-50 ${TRANSITION_BUTTON_STYLES.REJECTED}`}
              >
                Reject
              </button>
            ) : (
              <button
                key={status}
                type="button"
                disabled={submitting}
                onClick={() => handleTransition("APPROVED")}
                className={`rounded border px-2 py-1 text-[10px] font-medium disabled:opacity-50 ${TRANSITION_BUTTON_STYLES.APPROVED}`}
              >
                {submitting ? "Saving..." : `Move to ${PROJECT_STATUS_STYLES[status].label}`}
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
                    {entry.fromStatus ? `${PROJECT_STATUS_STYLES[entry.fromStatus].label} → ` : ""}
                    {PROJECT_STATUS_STYLES[entry.toStatus].label}
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
