"use client";

import React from "react";

type ProjectStatus =
  | "pending"
  | "in review"
  | "initial estimate range ready"
  | "refined estimate ready"
  | "consultation required"
  | "in progress"
  | "completed";

type ModificationRequest = {
  id: string;
  address: string;
  status: ProjectStatus;
  createdAt: string;
};

const mockRequests: ModificationRequest[] = [
  {
    id: "1",
    address: "123 Main St, Ottawa, ON",
    status: "pending",
    createdAt: "2026-03-10T10:00:00Z",
  },
  {
    id: "2",
    address: "45 Elm St, Ottawa, ON",
    status: "in review",
    createdAt: "2026-03-08T14:30:00Z",
  },
  {
    id: "3",
    address: "78 Pine Ave, Ottawa, ON",
    status: "completed",
    createdAt: "2026-03-05T09:15:00Z",
  },
  {
    id: "4",
    address: "15 Cedar Rd, Ottawa, ON",
    status: "consultation required",
    createdAt: "2026-03-01T12:00:00Z",
  },
];

const statusOptions: Array<"all" | ProjectStatus> = [
  "all",
  "pending",
  "in review",
  "initial estimate range ready",
  "refined estimate ready",
  "consultation required",
  "in progress",
  "completed",
];

export default function DashboardPage() {
  const [statusFilter, setStatusFilter] = React.useState<"all" | ProjectStatus>("all");

  const sortedRequests = [...mockRequests].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const filteredRequests =
    statusFilter === "all"
      ? sortedRequests
      : sortedRequests.filter((request) => request.status === statusFilter);

  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            View your submitted modification requests and track their current status.
          </p>
        </div>

        <section className="space-y-3">
          <label htmlFor="status-filter" className="block text-sm font-medium">
            Filter by status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | ProjectStatus)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status === "all" ? "All statuses" : status}
              </option>
            ))}
          </select>
        </section>

        <section className="space-y-4">
          {filteredRequests.length === 0 ? (
            <div className="rounded-md border border-input p-4 text-sm text-muted-foreground">
              No requests match this status.
            </div>
          ) : (
            filteredRequests.map((request) => (
              <article
                key={request.id}
                className="rounded-lg border border-input bg-background p-4 shadow-sm"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">{request.address}</h2>
                    <p className="text-sm text-muted-foreground">
                      Submitted on{" "}
                      {new Date(request.createdAt).toLocaleDateString("en-CA", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>

                  <span className="inline-flex w-fit rounded-full border px-3 py-1 text-xs font-medium capitalize">
                    {request.status}
                  </span>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}