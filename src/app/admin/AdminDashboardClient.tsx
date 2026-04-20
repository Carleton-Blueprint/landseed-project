"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

export interface SerializedProject {
  id: string;
  address: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    name: string | null;
    email: string | null;
  };
  photoCount: number;
  documentCount: number;
  documentsPendingReview: number;
  quote: {
    id: string;
    subtotal: string;
    total: string;
    status: string;
    generatedAt: string;
    openQuestions: number;
  } | null;
  eligibility: {
    id: string;
    overallDecision: string;
    discoveredGrants: Array<{
      grantId: string;
      title: string;
      scope: string;
      decision: string;
      relevanceScore: number;
      confidence: string;
      summary: string;
    }>;
    provider: string;
    assessedAt: string;
  } | null;
  builderTrendTransfer: {
    id: string;
    status: string;
    attempts: number;
    lastError: string | null;
    sentAt: string | null;
  } | null;
}

/* ================================================================== */
/*  Visual config                                                      */
/* ================================================================== */

const STATUS_STYLES: Record<string, { label: string; dot: string; badge: string }> = {
  draft: {
    label: "Draft",
    dot: "bg-gray-400",
    badge: "border-gray-200 bg-gray-50 text-gray-600",
  },
  submitted: {
    label: "Submitted",
    dot: "bg-blue-500",
    badge: "border-blue-200 bg-blue-50 text-blue-700",
  },
  estimate_ready: {
    label: "Estimate Ready",
    dot: "bg-violet-500",
    badge: "border-violet-200 bg-violet-50 text-violet-700",
  },
  accepted: {
    label: "Accepted",
    dot: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  declined: {
    label: "Declined",
    dot: "bg-red-400",
    badge: "border-red-200 bg-red-50 text-red-600",
  },
};

const DECISION_STYLES: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  ELIGIBLE: { label: "Eligible", icon: "✅", color: "text-emerald-700", bg: "bg-emerald-50" },
  NEEDS_MORE_INFO: { label: "More Info", icon: "📋", color: "text-amber-700", bg: "bg-amber-50" },
  MANUAL_REVIEW: { label: "Manual Review", icon: "👁️", color: "text-orange-700", bg: "bg-orange-50" },
  INELIGIBLE: { label: "Ineligible", icon: "ℹ️", color: "text-gray-600", bg: "bg-gray-50" },
};

const QUOTE_STATUS_STYLES: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Pending", color: "text-amber-700" },
  ACCEPTED: { label: "Accepted", color: "text-emerald-700" },
  DECLINED: { label: "Declined", color: "text-red-600" },
  EXPIRED: { label: "Expired", color: "text-orange-700" },
};

const TRANSFER_STATUS_STYLES: Record<string, { label: string; dot: string }> = {
  PENDING: { label: "Pending", dot: "bg-amber-500" },
  SENT: { label: "Sent", dot: "bg-emerald-500" },
  FAILED: { label: "Failed", dot: "bg-red-500" },
};

type FilterStatus = "all" | "draft" | "submitted" | "estimate_ready" | "accepted" | "declined";

type SortKey = "newest" | "oldest" | "status" | "estimate_high" | "estimate_low" | "confidence_high" | "confidence_low";

type FilterConfidence = "all" | "HIGH" | "MEDIUM" | "LOW";
type FilterDecision = "all" | "ELIGIBLE" | "NEEDS_MORE_INFO" | "MANUAL_REVIEW" | "INELIGIBLE";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest First" },
  { key: "oldest", label: "Oldest First" },
  { key: "status", label: "Status" },
  { key: "estimate_high", label: "Estimate: High → Low" },
  { key: "estimate_low", label: "Estimate: Low → High" },
  { key: "confidence_high", label: "AI Confidence: High → Low" },
  { key: "confidence_low", label: "AI Confidence: Low → High" },
];

const STATUS_RANK: Record<string, number> = {
  draft: 0,
  submitted: 1,
  estimate_ready: 2,
  accepted: 3,
  declined: 4,
};

const CONFIDENCE_RANK: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/** Get the best (highest) confidence from a project's discovered grants */
function bestConfidence(p: SerializedProject): number {
  if (!p.eligibility) return 0;
  return Math.max(
    0,
    ...p.eligibility.discoveredGrants.map(
      (g) => CONFIDENCE_RANK[g.confidence] ?? 0
    )
  );
}

/** Get the highest relevance score across a project's discovered grants */
function topRelevanceScore(p: SerializedProject): number {
  if (!p.eligibility) return 0;
  return Math.max(
    0,
    ...p.eligibility.discoveredGrants.map((g) => g.relevanceScore)
  );
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function getStatusConfig(status: string) {
  return STATUS_STYLES[status] ?? {
    label: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    dot: "bg-gray-400",
    badge: "border-gray-200 bg-gray-50 text-gray-600",
  };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtMoney(value: string) {
  return `$${parseFloat(value).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ================================================================== */
/*  Stat Card                                                          */
/* ================================================================== */

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent} text-lg`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Expanded Row Detail Panel                                          */
/* ================================================================== */

function ProjectDetailPanel({ project }: { project: SerializedProject }) {
  const eligibility = project.eligibility;
  const quote = project.quote;
  const transfer = project.builderTrendTransfer;
  const eligibleGrants = eligibility?.discoveredGrants.filter((g) => g.decision === "ELIGIBLE") ?? [];

  return (
    <div className="border-t bg-gray-50/70 px-6 py-5 space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {/* ── AI Estimation ── */}
        <div className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            AI Estimation
          </h4>
          {quote ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-gray-50 p-2">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Subtotal</p>
                  <p className="text-sm font-bold text-gray-900">{fmtMoney(quote.subtotal)}</p>
                </div>
                <div className="rounded-md bg-gray-50 p-2">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Total</p>
                  <p className="text-sm font-bold text-gray-900">{fmtMoney(quote.total)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                <span>
                  Status:{" "}
                  <strong className={QUOTE_STATUS_STYLES[quote.status]?.color ?? "text-gray-700"}>
                    {QUOTE_STATUS_STYLES[quote.status]?.label ?? quote.status}
                  </strong>
                </span>
                <span>Generated: {fmtDate(quote.generatedAt)}</span>
              </div>
              {quote.openQuestions > 0 && (
                <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs text-amber-700">
                  💬 {quote.openQuestions} open question{quote.openQuestions === 1 ? "" : "s"}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-500 italic">No quote generated yet.</p>
          )}
        </div>

        {/* ── AI Grant Discovery ── */}
        <div className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <svg className="h-4 w-4 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            AI Grant Discovery
            {eligibility && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-violet-100 border border-violet-200 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
                {eligibility.provider === "OPENAI" ? "AI Search" : "Heuristic"}
              </span>
            )}
          </h4>
          {eligibility ? (
            <>
              {/* Overall decision */}
              {(() => {
                const d = DECISION_STYLES[eligibility.overallDecision] ?? DECISION_STYLES.MANUAL_REVIEW;
                return (
                  <div className={`flex items-center gap-2 rounded-md ${d.bg} px-3 py-2`}>
                    <span>{d.icon}</span>
                    <span className={`text-sm font-semibold ${d.color}`}>{d.label}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      {eligibility.discoveredGrants.length} program{eligibility.discoveredGrants.length === 1 ? "" : "s"}
                    </span>
                  </div>
                );
              })()}

              {/* Grant list */}
              {eligibility.discoveredGrants.length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {eligibility.discoveredGrants.map((g) => {
                    const gd = DECISION_STYLES[g.decision];
                    return (
                      <div
                        key={g.grantId}
                        className="flex items-center gap-2 rounded-md border bg-gray-50 px-2.5 py-1.5 text-xs"
                      >
                        <span className="shrink-0">{gd?.icon ?? "📋"}</span>
                        <span className="truncate font-medium text-gray-800 flex-1">
                          {g.title}
                        </span>
                        <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-mono">
                          {g.relevanceScore}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-[10px] text-gray-400">
                Assessed: {fmtDate(eligibility.assessedAt)}
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2 rounded-md bg-gray-50 border border-dashed border-gray-300 px-3 py-2.5 text-xs text-gray-500">
              🔍 Discovery pending — intake not finalized
            </div>
          )}
        </div>

        {/* ── BuilderTrend Transfer + Documents ── */}
        <div className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
            Transfer & Documents
          </h4>

          {/* BuilderTrend */}
          {transfer ? (
            <div className="rounded-md bg-gray-50 p-2.5 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${TRANSFER_STATUS_STYLES[transfer.status]?.dot ?? "bg-gray-400"}`} />
                <span className="font-medium text-gray-800">
                  BuilderTrend: {TRANSFER_STATUS_STYLES[transfer.status]?.label ?? transfer.status}
                </span>
                <span className="text-gray-400">({transfer.attempts} attempt{transfer.attempts === 1 ? "" : "s"})</span>
              </div>
              {transfer.lastError && (
                <p className="text-[10px] text-red-500 truncate" title={transfer.lastError}>
                  Error: {transfer.lastError}
                </p>
              )}
              {transfer.sentAt && (
                <p className="text-[10px] text-gray-400">Sent: {fmtDate(transfer.sentAt)}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">No BuilderTrend transfer initiated.</p>
          )}

          {/* Documents summary */}
          <div className="rounded-md bg-gray-50 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-700">
                📄 {project.documentCount} document{project.documentCount === 1 ? "" : "s"}
              </span>
              {project.documentsPendingReview > 0 && (
                <span className="rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {project.documentsPendingReview} pending review
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-gray-700">
                📷 {project.photoCount} photo{project.photoCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {/* Quick links */}
          <div className="flex gap-2">
            <Link href={`/dashboard/${project.id}`} className="flex-1">
              <Button variant="outline" className="w-full text-xs h-8">
                View Details
              </Button>
            </Link>
            {project.quote && (
              <Link href={`/projects/${project.id}/estimate`} className="flex-1">
                <Button variant="outline" className="w-full text-xs h-8">
                  Estimate
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main Admin Dashboard                                               */
/* ================================================================== */

export function AdminDashboardClient({
  projects,
  userName,
}: {
  projects: SerializedProject[];
  userName: string;
}) {
  const [search, setSearch] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState<FilterStatus>("all");
  const [filterConfidence, setFilterConfidence] = React.useState<FilterConfidence>("all");
  const [filterDecision, setFilterDecision] = React.useState<FilterDecision>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("newest");
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  /* ---- Filter + Sort pipeline ---- */
  const filtered = React.useMemo(() => {
    let result = [...projects];

    // Status filter
    if (filterStatus !== "all") {
      result = result.filter((p) => p.status === filterStatus);
    }

    // AI confidence filter
    if (filterConfidence !== "all") {
      result = result.filter((p) => {
        if (!p.eligibility) return false;
        return p.eligibility.discoveredGrants.some(
          (g) => g.confidence === filterConfidence
        );
      });
    }

    // Grant decision filter
    if (filterDecision !== "all") {
      result = result.filter((p) => {
        if (!p.eligibility) return false;
        return p.eligibility.overallDecision === filterDecision;
      });
    }

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.address.toLowerCase().includes(q) ||
          p.client.name?.toLowerCase().includes(q) ||
          p.client.email?.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
      );
    }

    // Sorting
    result.sort((a, b) => {
      switch (sortKey) {
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "status":
          return (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
        case "estimate_high": {
          const aTotal = a.quote ? parseFloat(a.quote.total) : -1;
          const bTotal = b.quote ? parseFloat(b.quote.total) : -1;
          return bTotal - aTotal;
        }
        case "estimate_low": {
          const aTotal = a.quote ? parseFloat(a.quote.total) : Infinity;
          const bTotal = b.quote ? parseFloat(b.quote.total) : Infinity;
          return aTotal - bTotal;
        }
        case "confidence_high":
          return bestConfidence(b) - bestConfidence(a) || topRelevanceScore(b) - topRelevanceScore(a);
        case "confidence_low":
          return bestConfidence(a) - bestConfidence(b) || topRelevanceScore(a) - topRelevanceScore(b);
        default:
          return 0;
      }
    });

    return result;
  }, [projects, filterStatus, filterConfidence, filterDecision, sortKey, search]);

  /* ---- Active filter count (for the badge) ---- */
  const activeFilterCount =
    (filterStatus !== "all" ? 1 : 0) +
    (filterConfidence !== "all" ? 1 : 0) +
    (filterDecision !== "all" ? 1 : 0);

  /* ---- Stats ---- */
  const totalProjects = projects.length;
  const pendingReview = projects.filter((p) => p.status === "submitted" || p.status === "draft").length;
  const withEligibleGrants = projects.filter(
    (p) => p.eligibility?.overallDecision === "ELIGIBLE"
  ).length;
  const openQuestions = projects.reduce(
    (sum, p) => sum + (p.quote?.openQuestions ?? 0),
    0
  );

  const filterButtons: { key: FilterStatus; label: string }[] = [
    { key: "all", label: `All (${totalProjects})` },
    { key: "draft", label: "Draft" },
    { key: "submitted", label: "Submitted" },
    { key: "estimate_ready", label: "Estimate Ready" },
    { key: "accepted", label: "Accepted" },
    { key: "declined", label: "Declined" },
  ];

  return (
    <main className="min-h-screen bg-gray-50/60">
      {/* ─── Header ─── */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6 py-5 md:px-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                Advisory Team Dashboard
              </h1>
              <p className="mt-0.5 text-sm text-gray-500">
                Welcome back, {userName}. Monitor all project requests and AI-driven assessments.
              </p>
            </div>
            <Link href="/dashboard">
              <Button variant="outline" className="gap-1.5 text-sm">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Client Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6 md:px-8 space-y-6">
        {/* ─── Stats ─── */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total Projects" value={totalProjects} icon="📋" accent="bg-blue-100" />
          <StatCard label="Pending Review" value={pendingReview} icon="⏳" accent="bg-amber-100" />
          <StatCard label="Grant Eligible" value={withEligibleGrants} icon="✅" accent="bg-emerald-100" />
          <StatCard label="Open Questions" value={openQuestions} icon="💬" accent="bg-violet-100" />
        </div>

        {/* ─── Search + Filters + Sort ─── */}
        <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
          {/* Row 1: Search + Sort */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Search */}
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                id="admin-project-search"
                placeholder="Search by address, client name, email, or ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {/* Sort dropdown */}
            <div className="flex items-center gap-2 shrink-0">
              <label htmlFor="admin-sort" className="text-xs font-medium text-gray-500 whitespace-nowrap">
                Sort by
              </label>
              <select
                id="admin-sort"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Status filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {filterButtons.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilterStatus(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filterStatus === f.key
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                id={`filter-${f.key}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Row 3: Advanced filters */}
          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
            <span className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-600 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </span>

            {/* AI Confidence filter */}
            <select
              id="filter-confidence"
              value={filterConfidence}
              onChange={(e) => setFilterConfidence(e.target.value as FilterConfidence)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 ${
                filterConfidence !== "all"
                  ? "border-violet-300 bg-violet-50 text-violet-700 font-medium"
                  : "border-gray-200 bg-gray-50 text-gray-600"
              }`}
            >
              <option value="all">AI Confidence: All</option>
              <option value="HIGH">🟢 High Confidence</option>
              <option value="MEDIUM">🟡 Medium Confidence</option>
              <option value="LOW">🔴 Low Confidence</option>
            </select>

            {/* Grant decision filter */}
            <select
              id="filter-decision"
              value={filterDecision}
              onChange={(e) => setFilterDecision(e.target.value as FilterDecision)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 ${
                filterDecision !== "all"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 font-medium"
                  : "border-gray-200 bg-gray-50 text-gray-600"
              }`}
            >
              <option value="all">Grant Decision: All</option>
              <option value="ELIGIBLE">✅ Eligible</option>
              <option value="NEEDS_MORE_INFO">📋 Needs More Info</option>
              <option value="MANUAL_REVIEW">👁️ Manual Review</option>
              <option value="INELIGIBLE">ℹ️ Ineligible</option>
            </select>

            {/* Clear all filters */}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setFilterStatus("all");
                  setFilterConfidence("all");
                  setFilterDecision("all");
                  setSearch("");
                }}
                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
                id="clear-all-filters"
              >
                ✕ Clear all
              </button>
            )}
          </div>
        </div>

        {/* ─── Project Table ─── */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-10 text-center">
              <span className="text-3xl">🔍</span>
              <p className="mt-2 text-sm text-gray-500">
                No projects match your current filters.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((project) => {
                const statusConfig = getStatusConfig(project.status);
                const eligibility = project.eligibility;
                const d = eligibility
                  ? DECISION_STYLES[eligibility.overallDecision] ?? DECISION_STYLES.MANUAL_REVIEW
                  : null;
                const eligibleCount = eligibility?.discoveredGrants.filter(
                  (g) => g.decision === "ELIGIBLE"
                ).length ?? 0;
                const isExpanded = expandedId === project.id;

                return (
                  <div key={project.id}>
                    {/* Row */}
                    <button
                      type="button"
                      className={`w-full text-left px-5 py-4 transition-colors hover:bg-gray-50/80 ${
                        isExpanded ? "bg-gray-50/60" : ""
                      }`}
                      onClick={() => setExpandedId(isExpanded ? null : project.id)}
                      id={`admin-row-${project.id}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        {/* Col 1: Project info */}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {project.address}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${statusConfig.badge}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`} />
                              {statusConfig.label}
                            </span>
                            <span>{fmtDate(project.createdAt)}</span>
                          </div>
                        </div>

                        {/* Col 2: Client */}
                        <div className="sm:w-36 shrink-0">
                          <p className="text-xs font-medium text-gray-800 truncate">
                            {project.client.name ?? "—"}
                          </p>
                          <p className="text-[10px] text-gray-400 truncate">
                            {project.client.email ?? "No email"}
                          </p>
                        </div>

                        {/* Col 3: AI Estimation */}
                        <div className="sm:w-28 shrink-0">
                          {project.quote ? (
                            <div>
                              <p className="text-sm font-bold text-gray-900">
                                {fmtMoney(project.quote.total)}
                              </p>
                              <p className={`text-[10px] font-medium ${QUOTE_STATUS_STYLES[project.quote.status]?.color ?? "text-gray-500"}`}>
                                {QUOTE_STATUS_STYLES[project.quote.status]?.label ?? project.quote.status}
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 italic">No estimate</p>
                          )}
                        </div>

                        {/* Col 4: AI Grant Discovery */}
                        <div className="sm:w-40 shrink-0">
                          {eligibility ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{d!.icon}</span>
                              <div>
                                <p className={`text-xs font-semibold ${d!.color}`}>{d!.label}</p>
                                <p className="text-[10px] text-gray-500">
                                  {eligibility.discoveredGrants.length} found
                                  {eligibleCount > 0 && ` · ${eligibleCount} eligible`}
                                </p>
                              </div>
                              <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-medium text-violet-600">
                                <svg className="h-2 w-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                </svg>
                                AI
                              </span>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 italic">Pending</p>
                          )}
                        </div>

                        {/* Col 5: Expand chevron */}
                        <div className="sm:w-6 shrink-0 flex items-center justify-center">
                          <svg
                            className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>
                      </div>
                    </button>

                    {/* Expanded detail panel */}
                    {isExpanded && <ProjectDetailPanel project={project} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Footer ─── */}
        <p className="text-center text-xs text-gray-400">
          Showing {filtered.length} of {totalProjects} project{totalProjects === 1 ? "" : "s"} ·
          Grant eligibility data is AI-sourced and should be verified before client communication.
        </p>
      </div>
    </main>
  );
}
