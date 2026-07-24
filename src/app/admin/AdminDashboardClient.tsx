"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";
import { StaffNotesPanel } from "@/frontend/components/StaffNotesPanel";
import {
  CheckCircleIcon,
  ClipboardIcon,
  EyeIcon,
  InfoIcon,
  HourglassIcon,
  MessageIcon,
  SearchIcon,
  FileIcon,
  CameraIcon,
} from "@/frontend/components/icons";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

export interface SerializedProject {
  id: string;
  address: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  modificationType: string;
  hasManualReviewFlag?: boolean;
  manualReviewReason?: string | null;
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
    estimateMin?: string | null;
    estimateMax?: string | null;
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
  submissionData?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    ownershipStatus?: string | null;
    ownershipOtherDetails?: string | null;
    landlordName?: string | null;
    landlordPhone?: string | null;
    isCaregiver?: boolean;
    seniorName?: string | null;
    relationshipToSenior?: string | null;
    caregiverConsentConfirmed?: boolean;
    modificationItems?: string[];
    additionalDetails?: string | null;
    urgency?: string | null;
    submittedAt?: string | null;
  };
  photos?: Array<{
    id: string;
    url: string;
    virus_scan_status: string;
    createdAt: string;
  }>;
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
  estimate_expired: {
    label: "Estimate Expired",
    dot: "bg-orange-500",
    badge: "border-orange-200 bg-orange-50 text-orange-700",
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

const DECISION_STYLES: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  ELIGIBLE: { label: "Eligible", icon: <CheckCircleIcon size={16} className="text-emerald-600" />, color: "text-emerald-700", bg: "bg-emerald-50" },
  NEEDS_MORE_INFO: { label: "More Info", icon: <ClipboardIcon size={16} className="text-amber-600" />, color: "text-amber-700", bg: "bg-amber-50" },
  MANUAL_REVIEW: { label: "Manual Review", icon: <EyeIcon size={16} className="text-orange-600" />, color: "text-orange-700", bg: "bg-orange-50" },
  INELIGIBLE: { label: "Ineligible", icon: <InfoIcon size={16} className="text-gray-500" />, color: "text-gray-600", bg: "bg-gray-50" },
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

type FilterStatus = "all" | "draft" | "submitted" | "estimate_ready" | "estimate_expired" | "accepted" | "declined";

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
  estimate_expired: 3,
  accepted: 4,
  declined: 5,
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
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}>{icon}</div>
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

  return (
    <div className="border-t bg-gray-50/70 px-6 py-5 space-y-5">
      {/* ── Client Intake Submission Details ── */}
      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <ClipboardIcon size={16} className="text-blue-600" />
            Client Intake Submission Details
          </h4>
          <span className="text-xs text-gray-500">
            Submitted: {project.submissionData?.submittedAt ? fmtDate(project.submissionData.submittedAt) : fmtDate(project.createdAt)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
          {/* Client & Property Details */}
          <div className="space-y-2">
            <h5 className="font-semibold uppercase tracking-wider text-[10px] text-gray-400">Client & Property Info</h5>
            <div className="space-y-1.5 text-gray-600">
              <p><strong className="text-gray-900">Name:</strong> {project.submissionData?.name || project.client.name || "Not provided"}</p>
              <p><strong className="text-gray-900">Email:</strong> {project.submissionData?.email || project.client.email || "Not provided"}</p>
              <p><strong className="text-gray-900">Phone:</strong> {project.submissionData?.phone || "Not provided"}</p>
              <p><strong className="text-gray-900">Address:</strong> {project.submissionData?.addressLine1 || project.address}{project.submissionData?.addressLine2 ? `, ${project.submissionData.addressLine2}` : ""}</p>
              {(project.submissionData?.city || project.submissionData?.province || project.submissionData?.postalCode) && (
                <p className="text-gray-500">{[project.submissionData?.city, project.submissionData?.province, project.submissionData?.postalCode].filter(Boolean).join(", ")}</p>
              )}
              <p><strong className="text-gray-900">Ownership:</strong> <span className="capitalize">{project.submissionData?.ownershipStatus || "Not provided"}</span></p>
              {project.submissionData?.ownershipStatus === "tenant" && (
                <div className="mt-1.5 rounded bg-amber-50 p-2 border border-amber-200 text-amber-800 space-y-0.5">
                  <p className="font-semibold text-[11px]">Landlord Contact:</p>
                  <p>Name: {project.submissionData.landlordName || "Not provided"}</p>
                  <p>Phone: {project.submissionData.landlordPhone || "Not provided"}</p>
                </div>
              )}
              {project.submissionData?.ownershipStatus === "other" && project.submissionData.ownershipOtherDetails && (
                <p className="italic text-gray-500">Note: {project.submissionData.ownershipOtherDetails}</p>
              )}
            </div>
          </div>

          {/* Requested Modifications & Scope */}
          <div className="space-y-2">
            <h5 className="font-semibold uppercase tracking-wider text-[10px] text-gray-400">Requested Scope</h5>
            <div className="space-y-2.5 text-gray-600">
              <div>
                <strong className="text-gray-900 block mb-1">Modification Items:</strong>
                {project.submissionData?.modificationItems && project.submissionData.modificationItems.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {project.submissionData.modificationItems.map((item, idx) => (
                      <span key={idx} className="inline-flex items-center rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-400 italic">No specific items listed ({project.modificationType})</span>
                )}
              </div>
              <p><strong className="text-gray-900">Urgency:</strong> <span className="capitalize">{project.submissionData?.urgency || "Not specified"}</span></p>
              {project.submissionData?.additionalDetails && (
                <div className="rounded bg-gray-50 p-2 border text-gray-700">
                  <strong className="text-gray-900 block text-[11px] mb-0.5">Additional Notes:</strong>
                  <p className="italic">{project.submissionData.additionalDetails}</p>
                </div>
              )}
            </div>
          </div>

          {/* Caregiver & Submitted Photos */}
          <div className="space-y-3">
            {project.submissionData?.isCaregiver ? (
              <div className="space-y-2">
                <h5 className="font-semibold uppercase tracking-wider text-[10px] text-gray-400">Caregiver Information</h5>
                <div className="rounded bg-blue-50/50 p-2.5 border border-blue-100 text-gray-700 space-y-1">
                  <p><strong className="text-gray-900">Senior Name:</strong> {project.submissionData.seniorName || "Not provided"}</p>
                  <p><strong className="text-gray-900">Relationship:</strong> {project.submissionData.relationshipToSenior || "Not provided"}</p>
                  <p className="flex items-center gap-1 text-emerald-700 font-medium mt-1">
                    <CheckCircleIcon size={14} className="text-emerald-600" />
                    {project.submissionData.caregiverConsentConfirmed ? "Caregiver consent confirmed" : "Consent pending"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <h5 className="font-semibold uppercase tracking-wider text-[10px] text-gray-400">Caregiver Information</h5>
                <p className="text-gray-500 italic">Submitted directly by client (not a caregiver).</p>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <h5 className="font-semibold uppercase tracking-wider text-[10px] text-gray-400">Submitted Photos ({project.photos?.length ?? project.photoCount})</h5>
              {project.photos && project.photos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {project.photos.map((photo) => (
                    <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer" className="group relative block aspect-square rounded overflow-hidden border bg-gray-100">
                      <img src={photo.url} alt="Submitted photo" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                      <span className={`absolute bottom-1 right-1 rounded px-1 py-0.5 text-[8px] font-bold uppercase text-white shadow-sm ${photo.virus_scan_status === "clean" ? "bg-emerald-600" : photo.virus_scan_status === "infected" ? "bg-red-600" : "bg-amber-500"}`}>
                        {photo.virus_scan_status}
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 italic">No photos uploaded.</p>
              )}
            </div>
          </div>
        </div>
      </div>

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
                    <MessageIcon size={14} className="text-amber-600" /> {quote.openQuestions} open question{quote.openQuestions === 1 ? "" : "s"}
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
                        <span className="shrink-0">{gd?.icon ?? <ClipboardIcon size={14} className="text-gray-400" />}</span>
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
                <SearchIcon size={14} className="text-gray-400" /> Discovery pending -- intake not finalized
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
                <span className="text-gray-700 flex items-center gap-1">
                  <FileIcon size={14} className="text-gray-400" /> {project.documentCount} document{project.documentCount === 1 ? "" : "s"}
              </span>
              {project.documentsPendingReview > 0 && (
                <span className="rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {project.documentsPendingReview} pending review
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-gray-700 flex items-center gap-1">
                <CameraIcon size={14} className="text-gray-400" /> {project.photoCount} photo{project.photoCount === 1 ? "" : "s"}
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

      {/* Internal Staff Notes */}
      <StaffNotesPanel projectId={project.id} />
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
  const [activeTab, setActiveTab] = React.useState<"projects" | "analytics">("projects");
  const [search, setSearch] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState<FilterStatus>("all");
  const [filterConfidence, setFilterConfidence] = React.useState<FilterConfidence>("all");
  const [filterDecision, setFilterDecision] = React.useState<FilterDecision>("all");
  const [filterModification, setFilterModification] = React.useState<string>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("newest");
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  /* ---- Analytics Computation ---- */
  const analyticsData = React.useMemo(() => {
    const total = projects.length;
    const automatedCount = projects.filter((p) => !p.hasManualReviewFlag).length;
    const automationRate = total > 0 ? (automatedCount / total) * 100 : 0;

    // Filter projects with quotes that have valid min/max estimates
    const projectsWithQuotes = projects.filter(
      (p) =>
        p.quote &&
        p.quote.estimateMin !== null &&
        p.quote.estimateMin !== undefined &&
        p.quote.estimateMax !== null &&
        p.quote.estimateMax !== undefined
    );

    let inRangeCount = 0;
    let underEstimateCount = 0;
    let overEstimateCount = 0;
    let totalDeviationPct = 0;
    let deviationCount = 0;

    projectsWithQuotes.forEach((p) => {
      const q = p.quote!;
      const totalCost = parseFloat(q.total);
      const min = parseFloat(q.estimateMin!);
      const max = parseFloat(q.estimateMax!);

      if (!isNaN(totalCost) && !isNaN(min) && !isNaN(max)) {
        if (totalCost < min) {
          underEstimateCount++;
        } else if (totalCost > max) {
          overEstimateCount++;
        } else {
          inRangeCount++;
        }

        const midpoint = (min + max) / 2;
        if (midpoint > 0) {
          totalDeviationPct += (Math.abs(totalCost - midpoint) / midpoint) * 100;
          deviationCount++;
        }
      }
    });

    const quoteCount = projectsWithQuotes.length;
    const pricingAccuracy = quoteCount > 0 ? (inRangeCount / quoteCount) * 100 : 0;
    const avgDeviation = deviationCount > 0 ? totalDeviationPct / deviationCount : 0;

    // Automation by modification type
    const modTypes = ["GRAB_BARS", "RAMPS", "STAIR_LIFT", "SHOWER", "DOORS"];
    const automationByMod = modTypes.map((type) => {
      const typeProjects = projects.filter((p) => p.modificationType === type);
      const typeTotal = typeProjects.length;
      const typeAutomated = typeProjects.filter((p) => !p.hasManualReviewFlag).length;
      const rate = typeTotal > 0 ? (typeAutomated / typeTotal) * 100 : 0;
      return {
        type,
        total: typeTotal,
        automated: typeAutomated,
        rate,
      };
    });

    // Manual review reasons
    const flaggedProjects = projects.filter((p) => p.hasManualReviewFlag);
    const reasonCounts: Record<string, number> = {};
    flaggedProjects.forEach((p) => {
      const reason = p.manualReviewReason ?? "UNKNOWN";
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    });

    return {
      total,
      automatedCount,
      automationRate,
      quoteCount,
      inRangeCount,
      underEstimateCount,
      overEstimateCount,
      pricingAccuracy,
      avgDeviation,
      automationByMod,
      flaggedProjects,
      reasonCounts,
    };
  }, [projects]);

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

    // Modification type filter
    if (filterModification !== "all") {
      result = result.filter((p) => p.modificationType === filterModification);
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
  }, [projects, filterStatus, filterConfidence, filterDecision, filterModification, sortKey, search]);

  /* ---- Active filter count (for the badge) ---- */
  const activeFilterCount =
    (filterStatus !== "all" ? 1 : 0) +
    (filterConfidence !== "all" ? 1 : 0) +
    (filterDecision !== "all" ? 1 : 0) +
    (filterModification !== "all" ? 1 : 0);

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
    { key: "estimate_expired", label: "Estimate Expired" },
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
                Advisor Panel
              </h1>
              <p className="mt-0.5 text-sm text-gray-500">
                {userName === "Dev User" ? "Welcome back. " : `Welcome back, ${userName}. `}
                Monitor all project requests and AI-driven assessments.
              </p>
            </div>
            <Link href="/dashboard">
              <Button variant="outline" className="gap-1.5 text-sm">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Project Tracker
              </Button>
            </Link>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-5 flex gap-6 border-b border-gray-150">
            <button
              type="button"
              onClick={() => setActiveTab("projects")}
              className={`pb-3 px-1 border-b-2 font-medium text-sm transition-all -mb-px flex items-center gap-1.5 ${
                activeTab === "projects"
                  ? "border-blue-600 text-blue-600 font-semibold"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
              id="tab-projects"
            >
              <ClipboardIcon size={16} />
              Projects List
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("analytics")}
              className={`pb-3 px-1 border-b-2 font-medium text-sm transition-all -mb-px flex items-center gap-1.5 ${
                activeTab === "analytics"
                  ? "border-blue-600 text-blue-600 font-semibold"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
              id="tab-analytics"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
              </svg>
              Real-Time Analytics
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6 md:px-8 space-y-6">
        {/* ─── Stats ─── */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total Projects" value={totalProjects} icon={<ClipboardIcon size={20} className="text-blue-600" />} accent="bg-blue-100" />
          <StatCard label="Pending Review" value={pendingReview} icon={<HourglassIcon size={20} className="text-amber-600" />} accent="bg-amber-100" />
          <StatCard label="Grant Eligible" value={withEligibleGrants} icon={<CheckCircleIcon size={20} className="text-emerald-600" />} accent="bg-emerald-100" />
          <StatCard label="Open Questions" value={openQuestions} icon={<MessageIcon size={20} className="text-violet-600" />} accent="bg-violet-100" />
        </div>

        {activeTab === "analytics" ? (
          <div className="space-y-6">
            {/* Top KPI Cards (Large circles / stats) */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {/* Automation Rate KPI Card */}
              <div className="rounded-xl border bg-white p-6 shadow-sm flex flex-col items-center justify-between text-center relative overflow-hidden group hover:shadow-md transition-all">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Project Automation Rate</h3>
                  <p className="text-xs text-gray-400">Target: 80% automated</p>
                </div>

                {/* Progress Ring */}
                <div className="my-6 relative flex items-center justify-center">
                  <svg className="w-32 h-32 transform -rotate-90">
                    <circle cx="64" cy="64" r="54" className="stroke-gray-100" strokeWidth="10" fill="transparent" />
                    <circle
                      cx="64"
                      cy="64"
                      r="54"
                      className="stroke-blue-600 transition-all duration-1000 ease-out"
                      strokeWidth="10"
                      fill="transparent"
                      strokeDasharray={2 * Math.PI * 54}
                      strokeDashoffset={2 * Math.PI * 54 * (1 - analyticsData.automationRate / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute text-center">
                    <span className="text-2xl font-bold text-gray-900">{analyticsData.automationRate.toFixed(1)}%</span>
                    <span className="block text-[10px] text-gray-400">{analyticsData.automatedCount} / {analyticsData.total} projects</span>
                  </div>
                </div>

                <div className="text-xs text-gray-500 mt-2">
                  Projects built without triggering manual human advisor review flags.
                </div>
              </div>

              {/* Pricing Accuracy KPI Card */}
              <div className="rounded-xl border bg-white p-6 shadow-sm flex flex-col items-center justify-between text-center relative overflow-hidden group hover:shadow-md transition-all">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Pricing Accuracy</h3>
                  <p className="text-xs text-gray-400">Quotes matching estimate range</p>
                </div>

                {/* Progress Ring */}
                <div className="my-6 relative flex items-center justify-center">
                  <svg className="w-32 h-32 transform -rotate-90">
                    <circle cx="64" cy="64" r="54" className="stroke-gray-100" strokeWidth="10" fill="transparent" />
                    <circle
                      cx="64"
                      cy="64"
                      r="54"
                      className="stroke-emerald-500 transition-all duration-1000 ease-out"
                      strokeWidth="10"
                      fill="transparent"
                      strokeDasharray={2 * Math.PI * 54}
                      strokeDashoffset={2 * Math.PI * 54 * (1 - analyticsData.pricingAccuracy / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute text-center">
                    <span className="text-2xl font-bold text-gray-900">{analyticsData.pricingAccuracy.toFixed(1)}%</span>
                    <span className="block text-[10px] text-gray-400">{analyticsData.inRangeCount} / {analyticsData.quoteCount} quotes</span>
                  </div>
                </div>

                <div className="text-xs text-gray-500 mt-2">
                  Quotes where final total is within the initial estimate min/max range.
                </div>
              </div>

              {/* Average Deviation KPI Card */}
              <div className="rounded-xl border bg-white p-6 shadow-sm flex flex-col items-center justify-between text-center relative overflow-hidden group hover:shadow-md transition-all">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 to-purple-500" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Average Midpoint Deviation</h3>
                  <p className="text-xs text-gray-400">Mean absolute variation</p>
                </div>

                {/* Big Metric with Subtext */}
                <div className="my-10 flex flex-col items-center justify-center">
                  <span className="text-4xl font-extrabold text-gray-900">
                    ±{analyticsData.avgDeviation.toFixed(1)}%
                  </span>
                  <span className="mt-2 text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full font-medium">
                    {analyticsData.quoteCount} active quote{analyticsData.quoteCount === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="text-xs text-gray-500 mt-2">
                  Average percentage variance of the final quote from the initial estimate range midpoint.
                </div>
              </div>
            </div>

            {/* Double Column Layout: Charts & Insights */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Left Column: Visual Charts */}
              <div className="space-y-6">
                {/* Automation by Modification Type Bar Chart */}
                <div className="rounded-xl border bg-white p-6 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-gray-950">Automation Rate by Modification Type</h3>
                    <p className="text-xs text-gray-500">Compare automated processing across project types</p>
                  </div>

                  <div className="space-y-4">
                    {analyticsData.automationByMod.map((item) => {
                      const modNames: Record<string, string> = {
                        GRAB_BARS: "Grab Bars",
                        RAMPS: "Wheelchair Ramps",
                        STAIR_LIFT: "Stair Lift",
                        SHOWER: "Walk-in Shower",
                        DOORS: "Door Widening",
                      };
                      const modColors: Record<string, string> = {
                        GRAB_BARS: "bg-emerald-500",
                        RAMPS: "bg-blue-500",
                        STAIR_LIFT: "bg-violet-500",
                        SHOWER: "bg-teal-500",
                        DOORS: "bg-amber-500",
                      };

                      return (
                        <div key={item.type} className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="font-semibold text-gray-800">{modNames[item.type] ?? item.type}</span>
                            <span className="text-gray-500 font-medium">
                              {item.rate.toFixed(0)}% ({item.automated}/{item.total})
                            </span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                            <div
                              className={`${modColors[item.type] ?? "bg-gray-500"} h-full rounded-full transition-all duration-700`}
                              style={{ width: `${item.rate}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Pricing Deviation Distribution */}
                <div className="rounded-xl border bg-white p-6 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-gray-950">Pricing Deviation Distribution</h3>
                    <p className="text-xs text-gray-500">Distribution of quotes relative to estimates</p>
                  </div>

                  {/* Stacked bar or distribution visualization */}
                  {analyticsData.quoteCount > 0 ? (
                    <div className="space-y-6">
                      <div className="flex h-6 rounded-full overflow-hidden border">
                        {analyticsData.underEstimateCount > 0 && (
                          <div
                            className="bg-blue-400 text-white flex items-center justify-center text-[10px] font-bold transition-all"
                            style={{ width: `${(analyticsData.underEstimateCount / analyticsData.quoteCount) * 100}%` }}
                            title={`Under Estimate: ${analyticsData.underEstimateCount}`}
                          >
                            {((analyticsData.underEstimateCount / analyticsData.quoteCount) * 100).toFixed(0)}%
                          </div>
                        )}
                        {analyticsData.inRangeCount > 0 && (
                          <div
                            className="bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold transition-all"
                            style={{ width: `${(analyticsData.inRangeCount / analyticsData.quoteCount) * 100}%` }}
                            title={`In Range: ${analyticsData.inRangeCount}`}
                          >
                            {((analyticsData.inRangeCount / analyticsData.quoteCount) * 100).toFixed(0)}%
                          </div>
                        )}
                        {analyticsData.overEstimateCount > 0 && (
                          <div
                            className="bg-red-400 text-white flex items-center justify-center text-[10px] font-bold transition-all"
                            style={{ width: `${(analyticsData.overEstimateCount / analyticsData.quoteCount) * 100}%` }}
                            title={`Over Estimate: ${analyticsData.overEstimateCount}`}
                          >
                            {((analyticsData.overEstimateCount / analyticsData.quoteCount) * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-100">
                          <span className="block font-bold text-blue-700">{analyticsData.underEstimateCount}</span>
                          <span className="text-[10px] text-gray-500 font-medium">Under Estimate</span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                          <span className="block font-bold text-emerald-700">{analyticsData.inRangeCount}</span>
                          <span className="text-[10px] text-gray-500 font-medium">In Estimate Range</span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-red-50 border border-red-100">
                          <span className="block font-bold text-red-700">{analyticsData.overEstimateCount}</span>
                          <span className="text-[10px] text-gray-500 font-medium">Over Estimate</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-gray-400 italic">
                      No active quotes to display pricing deviation.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Insights & Flags Breakdown */}
              <div className="space-y-6">
                {/* Manual Review Reasons Breakdown */}
                <div className="rounded-xl border bg-white p-6 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-gray-950">Manual Review Flags Analysis</h3>
                    <p className="text-xs text-gray-500">Distribution of manual review triggers</p>
                  </div>

                  {analyticsData.flaggedProjects.length > 0 ? (
                    <div className="space-y-3">
                      {Object.entries(analyticsData.reasonCounts).map(([reason, count]) => {
                        const label = reason === "HIGH_COMPLEXITY" ? "High Complexity Project" :
                                      reason === "LOW_CONFIDENCE" ? "Low AI Confidence" :
                                      reason === "DOCUMENT_MISMATCH" ? "Document Verification Required" :
                                      reason;
                        const percentage = (count / analyticsData.flaggedProjects.length) * 100;
                        return (
                          <div key={reason} className="p-3 bg-gray-50 rounded-lg border border-gray-100 space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-gray-800">{label}</span>
                              <span className="font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-100">
                                {count} trigger{count > 1 ? "s" : ""}
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-orange-500 h-full rounded-full" style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-gray-400 italic">
                      Excellent! No manual review flags currently active.
                    </div>
                  )}
                </div>

                {/* Dynamic Advisor Insights Panel */}
                <div className="rounded-xl border bg-white p-6 shadow-sm space-y-4 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
                  <h3 className="text-base font-bold text-gray-950 flex items-center gap-1.5">
                    <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0-10.5v.008H12v-.008zm0 10.5L9 12h6l-3 6.75z" />
                    </svg>
                    Advisor Insights
                  </h3>

                  <div className="space-y-4 text-sm text-gray-600">
                    {/* Insight 1: Automation Rate */}
                    {analyticsData.automationRate < 80 ? (
                      <div className="flex gap-3">
                        <div className="shrink-0 h-2 w-2 rounded-full bg-amber-500 mt-1.5" />
                        <div>
                          <p className="font-semibold text-gray-800 text-xs">Automation rate below target</p>
                          <p className="text-xs mt-0.5">
                            The current automation rate is {analyticsData.automationRate.toFixed(1)}%, which is below the 80% operational target.
                            {analyticsData.reasonCounts["HIGH_COMPLEXITY"] && " The primary bottleneck is 'High Complexity' flags. Consider revising the complexity threshold."}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="shrink-0 h-2 w-2 rounded-full bg-emerald-500 mt-1.5" />
                        <div>
                          <p className="font-semibold text-gray-800 text-xs">Automation rate exceeds target</p>
                          <p className="text-xs mt-0.5">
                            Fantastic! The automation rate is at {analyticsData.automationRate.toFixed(1)}%, exceeding the target of 80%. System overhead is minimal.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Insight 2: Pricing Accuracy */}
                    {analyticsData.pricingAccuracy < 90 ? (
                      <div className="flex gap-3">
                        <div className="shrink-0 h-2 w-2 rounded-full bg-amber-500 mt-1.5" />
                        <div>
                          <p className="font-semibold text-gray-800 text-xs">Pricing accuracy alert</p>
                          <p className="text-xs mt-0.5">
                            {analyticsData.pricingAccuracy.toFixed(1)}% of quotes are in the estimate range.
                            {analyticsData.overEstimateCount > 0 && ` There are ${analyticsData.overEstimateCount} quotes exceeding maximum estimates. Check if contractors are including extra scope or if materials inflation has spiked.`}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="shrink-0 h-2 w-2 rounded-full bg-emerald-500 mt-1.5" />
                        <div>
                          <p className="font-semibold text-gray-800 text-xs">High pricing consistency</p>
                          <p className="text-xs mt-0.5">
                            Pricing model is highly calibrated. {analyticsData.pricingAccuracy.toFixed(1)}% of quotes are matching initial client estimates.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Insight 3: Hardest Type to Automate */}
                    {(() => {
                      const sortedMods = [...analyticsData.automationByMod].sort((a, b) => a.rate - b.rate);
                      const hardest = sortedMods[0];
                      if (hardest && hardest.rate < 100 && hardest.total > 0) {
                        const modNames: Record<string, string> = {
                          GRAB_BARS: "Grab Bars",
                          RAMPS: "Wheelchair Ramps",
                          STAIR_LIFT: "Stair Lifts",
                          SHOWER: "Walk-in Showers",
                          DOORS: "Door Widenings",
                        };
                        return (
                          <div className="flex gap-3">
                            <div className="shrink-0 h-2 w-2 rounded-full bg-violet-500 mt-1.5" />
                            <div>
                              <p className="font-semibold text-gray-800 text-xs">
                                {modNames[hardest.type]} require the most reviews
                              </p>
                              <p className="text-xs mt-0.5">
                                {modNames[hardest.type]} projects have the lowest automation rate ({hardest.rate.toFixed(0)}%).
                                Consider adding specific guidelines or improving the prompt template for this modification type.
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Table of Flagged Projects */}
            {analyticsData.flaggedProjects.length > 0 && (
              <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b bg-gray-50/50">
                  <h3 className="text-sm font-bold text-gray-900">Projects Requiring Attention ({analyticsData.flaggedProjects.length})</h3>
                  <p className="text-xs text-gray-500 mt-0.5">These projects triggered manual review and require human advisor approval</p>
                </div>
                <div className="divide-y text-xs">
                  {analyticsData.flaggedProjects.map((p) => (
                    <div key={p.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                      <div>
                        <p className="font-semibold text-gray-900">{p.address}</p>
                        <p className="text-gray-500 mt-0.5">
                          Client: {p.client.name} · Reason: <span className="font-mono text-orange-600 bg-orange-50 px-1 rounded">{p.manualReviewReason ?? "UNKNOWN"}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab("projects");
                          setSearch(p.id);
                          setExpandedId(p.id);
                        }}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-100 transition-colors"
                      >
                        Locate Project
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
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
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filterStatus === f.key
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
              className={`rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 ${filterConfidence !== "all"
                  ? "border-violet-300 bg-violet-50 text-violet-700 font-medium"
                  : "border-gray-200 bg-gray-50 text-gray-600"
                }`}
            >
              <option value="all">AI Confidence: All</option>
              <option value="HIGH">High Confidence</option>
              <option value="MEDIUM">Medium Confidence</option>
              <option value="LOW">Low Confidence</option>
            </select>

            {/* Grant decision filter */}
            <select
              id="filter-decision"
              value={filterDecision}
              onChange={(e) => setFilterDecision(e.target.value as FilterDecision)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 ${filterDecision !== "all"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 font-medium"
                  : "border-gray-200 bg-gray-50 text-gray-600"
                }`}
            >
              <option value="all">Grant Decision: All</option>
              <option value="ELIGIBLE">Eligible</option>
              <option value="NEEDS_MORE_INFO">Needs More Info</option>
              <option value="MANUAL_REVIEW">Manual Review</option>
              <option value="INELIGIBLE">Ineligible</option>
            </select>

            {/* Modification Type filter */}
            <select
              id="filter-modification"
              value={filterModification}
              onChange={(e) => setFilterModification(e.target.value)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 ${filterModification !== "all"
                  ? "border-blue-300 bg-blue-50 text-blue-700 font-medium"
                  : "border-gray-200 bg-gray-50 text-gray-600"
                }`}
            >
              <option value="all">Modification: All</option>
              <option value="GRAB_BARS">Grab Bars</option>
              <option value="RAMPS">Wheelchair Ramps</option>
              <option value="STAIR_LIFT">Stair Lift</option>
              <option value="SHOWER">Walk-in Shower</option>
              <option value="DOORS">Door Widening</option>
            </select>

            {/* Clear all filters */}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setFilterStatus("all");
                  setFilterConfidence("all");
                  setFilterDecision("all");
                  setFilterModification("all");
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
              <SearchIcon size={32} className="mx-auto text-gray-300" />
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
                      className={`w-full text-left px-5 py-4 transition-colors hover:bg-gray-50/80 ${isExpanded ? "bg-gray-50/60" : ""
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

                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                              project.modificationType === "GRAB_BARS" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                              project.modificationType === "RAMPS" ? "bg-blue-50 text-blue-700 border-blue-200" :
                              project.modificationType === "STAIR_LIFT" ? "bg-violet-50 text-violet-700 border-violet-200" :
                              project.modificationType === "SHOWER" ? "bg-teal-50 text-teal-700 border-teal-200" :
                              "bg-amber-50 text-amber-700 border-amber-200"
                            }`}>
                              {project.modificationType === "GRAB_BARS" ? "Grab Bars" :
                               project.modificationType === "RAMPS" ? "Wheelchair Ramps" :
                               project.modificationType === "STAIR_LIFT" ? "Stair Lift" :
                               project.modificationType === "SHOWER" ? "Walk-in Shower" :
                               "Door Widening"}
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
          </>
        )}
      </div>
    </main>
  );
}
