"use client";

import React from "react";
import {
  GlobeIcon,
  BuildingIcon,
  MapPinIcon,
  AwardIcon,
  ClipboardIcon,
  EyeIcon,
  InfoIcon,
  FileIcon,
  SearchIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
} from "@/frontend/components/icons";

/* ------------------------------------------------------------------ */
/* Types mirroring DiscoveredGrant from the eligibility backend        */
/* ------------------------------------------------------------------ */

type GrantScope = "MUNICIPAL" | "PROVINCIAL" | "NATIONAL";
type GrantDecision = "ELIGIBLE" | "INELIGIBLE" | "NEEDS_MORE_INFO" | "MANUAL_REVIEW";
type GrantConfidence = "HIGH" | "MEDIUM" | "LOW";

interface DiscoveredGrant {
  grantId: string;
  title: string;
  scope: GrantScope;
  jurisdiction: string;
  sourceUrl: string | null;
  summary: string;
  decision: GrantDecision;
  relevanceScore: number;
  confidence: GrantConfidence;
  matchedCriteria: string[];
  missingCriteria: string[];
  rationale: string;
}

interface GrantDiscoveryResponse {
  assessmentId: string;
  overallDecision: string;
  createdAt: string;
  discovery?: {
    provider: string;
    discoveredGrants: DiscoveredGrant[];
    metadata?: {
      candidateCount?: number;
      returnedCount?: number;
    };
  };
  /* Client-level view (no discovery object) is also valid */
}

/* ------------------------------------------------------------------ */
/* Visual helpers                                                      */
/* ------------------------------------------------------------------ */

const SCOPE_CONFIG: Record<GrantScope, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  NATIONAL: {
    label: "National",
    color: "text-violet-700",
    bg: "bg-violet-50",
    border: "border-violet-200",
    icon: <GlobeIcon size={14} />,
  },
  PROVINCIAL: {
    label: "Provincial",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    icon: <BuildingIcon size={14} />,
  },
  MUNICIPAL: {
    label: "Municipal",
    color: "text-teal-700",
    bg: "bg-teal-50",
    border: "border-teal-200",
    icon: <MapPinIcon size={14} />,
  },
};

const DECISION_CONFIG: Record<
  GrantDecision,
  { label: string; color: string; bg: string; border: string; ring: string }
> = {
  ELIGIBLE: {
    label: "Eligible",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    ring: "stroke-emerald-500",
  },
  NEEDS_MORE_INFO: {
    label: "More Info Needed",
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-300",
    ring: "stroke-amber-500",
  },
  MANUAL_REVIEW: {
    label: "Manual Review",
    color: "text-orange-700",
    bg: "bg-orange-50",
    border: "border-orange-300",
    ring: "stroke-orange-400",
  },
  INELIGIBLE: {
    label: "Not Eligible",
    color: "text-red-600",
    bg: "bg-red-50",
    border: "border-red-200",
    ring: "stroke-red-400",
  },
};

const CONFIDENCE_DOT: Record<GrantConfidence, string> = {
  HIGH: "bg-emerald-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-red-400",
};

function formatCriterion(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Relevance Score Ring (SVG)                                          */
/* ------------------------------------------------------------------ */

function ScoreRing({ score, strokeClass }: { score: number; strokeClass: string }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: 60, height: 60 }}>
      <svg width={60} height={60} className="-rotate-90">
        <circle cx={30} cy={30} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={5} />
        <circle
          cx={30}
          cy={30}
          r={radius}
          fill="none"
          className={strokeClass}
          strokeWidth={5}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <span className="absolute text-sm font-bold text-gray-800">{score}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Individual Grant Card                                               */
/* ------------------------------------------------------------------ */

function GrantCard({ grant, index }: { grant: DiscoveredGrant; index: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const scope = SCOPE_CONFIG[grant.scope] ?? SCOPE_CONFIG.NATIONAL;
  const decision = DECISION_CONFIG[grant.decision] ?? DECISION_CONFIG.INELIGIBLE;
  const confidenceDot = CONFIDENCE_DOT[grant.confidence] ?? CONFIDENCE_DOT.LOW;

  return (
    <div
      className="group relative overflow-hidden rounded-xl border bg-white shadow-sm transition-all duration-300 hover:shadow-md"
      style={{ animationDelay: `${index * 80}ms`, animation: "grantCardFadeIn 0.5s ease forwards", opacity: 0 }}
    >
      {/* Top accent bar */}
      <div
        className={`h-1 w-full ${
          grant.decision === "ELIGIBLE"
            ? "bg-gradient-to-r from-emerald-400 to-emerald-600"
            : grant.decision === "NEEDS_MORE_INFO"
            ? "bg-gradient-to-r from-amber-400 to-amber-600"
            : grant.decision === "MANUAL_REVIEW"
            ? "bg-gradient-to-r from-orange-400 to-orange-500"
            : "bg-gradient-to-r from-gray-300 to-gray-400"
        }`}
      />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start gap-4">
          <ScoreRing score={grant.relevanceScore} strokeClass={decision.ring} />

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${scope.bg} ${scope.color} ${scope.border} border`}
              >
                <span>{scope.icon}</span>
                {scope.label}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${decision.bg} ${decision.color} ${decision.border} border`}
              >
                {decision.label}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <span className={`inline-block h-2 w-2 rounded-full ${confidenceDot}`} />
                {grant.confidence} confidence
              </span>
            </div>

            <h3 className="text-base font-semibold text-gray-900 leading-snug">{grant.title}</h3>
            <p className="mt-1 text-sm text-gray-600 line-clamp-2">{grant.summary}</p>
          </div>
        </div>

        {/* Expandable detail section */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            id={`grant-detail-toggle-${grant.grantId}`}
          >
            {expanded ? "Hide details" : "View details"}
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expanded && (
            <div className="mt-3 space-y-3 border-t pt-3 text-sm animate-in slide-in-from-top-2 duration-200">
              {/* Rationale */}
              <div>
                <p className="font-medium text-gray-700 mb-1">Assessment Rationale</p>
                <p className="text-gray-600 italic">&ldquo;{grant.rationale}&rdquo;</p>
              </div>

              {/* Matched Criteria */}
              {grant.matchedCriteria.length > 0 && (
                <div>
                  <p className="font-medium text-gray-700 mb-1.5 flex items-center gap-1.5"><CheckCircleIcon size={14} className="text-emerald-600" /> Matched Criteria</p>
                  <div className="flex flex-wrap gap-1.5">
                    {grant.matchedCriteria.map((c) => (
                      <span
                        key={c}
                        className="inline-block rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700"
                      >
                        {formatCriterion(c)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing Criteria */}
              {grant.missingCriteria.length > 0 && (
                <div>
                  <p className="font-medium text-gray-700 mb-1.5 flex items-center gap-1.5"><AlertTriangleIcon size={14} className="text-amber-500" /> Missing Criteria</p>
                  <div className="flex flex-wrap gap-1.5">
                    {grant.missingCriteria.map((c) => (
                      <span
                        key={c}
                        className="inline-block rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700"
                      >
                        {formatCriterion(c)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Jurisdiction & Source */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 pt-1">
                <span>Jurisdiction: <strong>{grant.jurisdiction}</strong></span>
                {grant.sourceUrl && (
                  <a
                    href={grant.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    View source
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5-4.5h6m0 0v6m0-6L9.75 14.25"
                      />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeletons                                                   */
/* ------------------------------------------------------------------ */

function GrantCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="h-1 w-full bg-gray-200 animate-pulse" />
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="h-[60px] w-[60px] rounded-full bg-gray-200 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <div className="h-5 w-20 rounded-full bg-gray-200 animate-pulse" />
              <div className="h-5 w-16 rounded-full bg-gray-200 animate-pulse" />
            </div>
            <div className="h-5 w-3/4 rounded bg-gray-200 animate-pulse" />
            <div className="h-4 w-full rounded bg-gray-100 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overall Decision Banner                                             */
/* ------------------------------------------------------------------ */

function OverallDecisionBanner({
  decision,
  grantCount,
  assessedAt,
}: {
  decision: string;
  grantCount: number;
  assessedAt: string;
}) {
  const d = DECISION_CONFIG[(decision as GrantDecision)] ?? DECISION_CONFIG.MANUAL_REVIEW;

  const icons: Record<string, React.ReactNode> = {
    ELIGIBLE: <AwardIcon size={24} className="text-emerald-600" />,
    NEEDS_MORE_INFO: <ClipboardIcon size={24} className="text-amber-600" />,
    MANUAL_REVIEW: <EyeIcon size={24} className="text-orange-600" />,
    INELIGIBLE: <InfoIcon size={24} className="text-gray-500" />,
  };

  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border ${d.border} ${d.bg} p-4`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icons[decision] ?? <FileIcon size={24} className="text-gray-400" />}</span>
        <div>
          <p className={`text-sm font-bold ${d.color}`}>{d.label}</p>
          <p className="text-xs text-gray-600">
            {grantCount} grant program{grantCount === 1 ? "" : "s"} evaluated
          </p>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Assessed {new Date(assessedAt).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

export function GrantDiscoverySummary({ projectId }: { projectId: string }) {
  const [data, setData] = React.useState<GrantDiscoveryResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function fetchAssessment() {
      try {
        const res = await fetch(`/api/eligibility/${projectId}`);
        if (!res.ok) {
          if (res.status === 404) {
            // No assessment yet — not an error
            setData(null);
            return;
          }
          throw new Error(`Failed to load assessment (${res.status})`);
        }
        const json = (await res.json()) as GrantDiscoveryResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAssessment();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /* ---- Inline keyframe for card stagger animation ---- */
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "grant-card-animation";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes grantCardFadeIn {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <section className="rounded-xl border bg-white p-5 shadow-sm space-y-4" id="grant-discovery-section">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          <h2 className="text-lg font-semibold text-gray-900">Loading Grant Assessment…</h2>
        </div>
        <GrantCardSkeleton />
        <GrantCardSkeleton />
      </section>
    );
  }

  /* ---- Error state ---- */
  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm" id="grant-discovery-section">
        <h2 className="text-lg font-semibold text-red-800 mb-1">Grant Assessment Error</h2>
        <p className="text-sm text-red-600">{error}</p>
      </section>
    );
  }

  /* ---- No assessment yet ---- */
  if (!data) {
    return (
      <section className="rounded-xl border bg-white p-5 shadow-sm" id="grant-discovery-section">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">AI Grant Assessment</h2>
        <div className="relative overflow-hidden rounded-xl border border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50/20 to-violet-50/20 p-6 flex flex-col sm:flex-row items-center gap-4 shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 shadow-inner">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-20"></span>
            <SearchIcon size={24} className="text-indigo-500 animate-pulse" />
          </div>
          <div className="text-center sm:text-left">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">Assessment Pending</p>
              <span className="self-center sm:self-auto inline-flex items-center gap-1 rounded-full bg-indigo-100/80 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                Queued for finalization
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500 leading-relaxed max-w-xl">
              Grant eligibility discovery will run automatically once your project is finalized.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const grants = data.discovery?.discoveredGrants ?? [];
  const sortedGrants = [...grants].sort((a, b) => b.relevanceScore - a.relevanceScore);

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm space-y-5" id="grant-discovery-section">
      {/* Section header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <svg className="h-5 w-5 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
            />
          </svg>
          AI-Sourced Grant Discovery
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Grants automatically discovered and evaluated against your project profile.
        </p>
      </div>

      {/* Overall decision banner */}
      <OverallDecisionBanner
        decision={data.overallDecision}
        grantCount={sortedGrants.length}
        assessedAt={data.createdAt}
      />

      {/* Grant cards */}
      {sortedGrants.length > 0 ? (
        <div className="space-y-4">
          {sortedGrants.map((grant, i) => (
            <GrantCard key={grant.grantId} grant={grant} index={i} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-slate-50/50 p-8 flex flex-col items-center justify-center text-center shadow-sm">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <h4 className="text-sm font-semibold text-gray-900 mb-1">No Matching Programs</h4>
          <p className="max-w-[340px] text-xs text-gray-500 leading-normal">
            No grant programs were discovered for this project&apos;s profile.
          </p>
          <p className="mt-1 max-w-[280px] text-[11px] text-gray-400">
            We will continue tracking new funding opportunities as they release.
          </p>
        </div>
      )}

      {/* Discovery metadata footer */}
      {data.discovery?.metadata && (
        <div className="flex flex-wrap gap-4 border-t pt-3 text-xs text-gray-400">
          <span>Provider: {data.discovery.provider}</span>
          {data.discovery.metadata.candidateCount != null && (
            <span>Candidates: {data.discovery.metadata.candidateCount}</span>
          )}
          {data.discovery.metadata.returnedCount != null && (
            <span>Returned: {data.discovery.metadata.returnedCount}</span>
          )}
        </div>
      )}
    </section>
  );
}
