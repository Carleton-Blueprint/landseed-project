import { prisma } from "lib/prisma";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getEstimateRangeFromQuote } from "@/lib/estimate-range";
import {
  NotificationCenter,
  NotificationItem,
} from "@/frontend/components/NotificationCenter";
import {
  CheckCircleIcon,
  ClipboardIcon,
  EyeIcon,
  InfoIcon,
  GlobeIcon,
  BuildingIcon,
  MapPinIcon,
  SearchIcon,
  HomeIcon,
  CameraIcon,
} from "@/frontend/components/icons";

/* ------------------------------------------------------------------ */
/* Status helpers                                                      */
/* ------------------------------------------------------------------ */

function getStatusLabel(status: string) {
  if (status === "draft") return "Pending";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusStyle(status: string) {
  if (status === "draft")
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "submitted")
    return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "estimate_expired")
    return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

/* ------------------------------------------------------------------ */
/* Estimate helpers                                                    */
/* ------------------------------------------------------------------ */

function getEstimateSummary(project: {
  status: string;
  quotes?: Array<{
    estimateMin?: { toString(): string } | number | string | null;
    estimateMax?: { toString(): string } | number | string | null;
  }>;
}) {
  const latestQuote = project.quotes?.[0] ?? null;
  const estimateRange = getEstimateRangeFromQuote(latestQuote);
  const isFinalized = project.status !== "draft";

  if (!isFinalized) {
    return {
      title: "Initial estimate range",
      value: "Available after intake finalization",
      explanation:
        "Once your intake is finalized, an initial estimate range will appear here. Pricing is dynamically generated from real-time external retail data.",
    };
  }

  if (estimateRange) {
    return {
      title: "Initial estimate range",
      value: `$${estimateRange.min.toLocaleString()} – $${estimateRange.max.toLocaleString()}`,
      explanation:
        "This pricing is dynamically generated from real-time external retail data and may change as retailer pricing and product availability update.",
    };
  }

  return {
    title: "Initial estimate range",
    value: "Generating estimate…",
    explanation:
      "We are generating your estimate using real-time external retail data.",
  };
}

// TODO: replace with a real query once in-app notifications are persisted.
function getMockNotifications(projects: { id: string; address: string }[]): NotificationItem[] {
  const now = Date.now();
  const first = projects[0];
  const items: NotificationItem[] = [];

  if (first) {
    items.push({
      id: `mock-estimate-${first.id}`,
      kind: "estimate_ready",
      title: "Refined estimate ready for review",
      body: `Your refined estimate for ${first.address} is ready. Review the updated pricing and grant details.`,
      href: `/dashboard/${first.id}`,
      createdAt: new Date(now - 1000 * 60 * 12),
    });
    items.push({
      id: `mock-docs-${first.id}`,
      kind: "documents_requested",
      title: "Supporting documents requested",
      body: "Please upload proof of income and property ownership to continue your grant application.",
      href: `/dashboard/${first.id}`,
      createdAt: new Date(now - 1000 * 60 * 60 * 3),
    });
  }

  items.push({
    id: "mock-welcome",
    kind: "info",
    title: "Welcome to Landseed",
    body: "You can track every project you submit from this dashboard.",
    createdAt: new Date(now - 1000 * 60 * 60 * 26),
    read: true,
  });

  return items;
}

/* ------------------------------------------------------------------ */
/* AI Grant Discovery helpers                                          */
/* ------------------------------------------------------------------ */

type DiscoveredGrantSummary = {
  grantId: string;
  title: string;
  scope: string;
  decision: string;
  relevanceScore: number;
  confidence: string;
};

type ProjectEligibility = {
  overallDecision: string;
  discoveredGrants: DiscoveredGrantSummary[];
  provider: string | null;
  assessedAt: Date;
};

const DECISION_DISPLAY: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  ELIGIBLE: {
    label: "Grants Found",
    icon: <CheckCircleIcon size={18} className="text-emerald-600" />,
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
  },
  NEEDS_MORE_INFO: {
    label: "More Info Needed",
    icon: <ClipboardIcon size={18} className="text-amber-600" />,
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  MANUAL_REVIEW: {
    label: "Manual Review",
    icon: <EyeIcon size={18} className="text-orange-600" />,
    color: "text-orange-700",
    bg: "bg-orange-50",
    border: "border-orange-200",
  },
  INELIGIBLE: {
    label: "No Matches",
    icon: <InfoIcon size={18} className="text-gray-500" />,
    color: "text-gray-600",
    bg: "bg-gray-50",
    border: "border-gray-200",
  },
};

const SCOPE_ICONS: Record<string, React.ReactNode> = {
  NATIONAL: <GlobeIcon size={14} />,
  PROVINCIAL: <BuildingIcon size={14} />,
  MUNICIPAL: <MapPinIcon size={14} />,
};

function countByScope(grants: DiscoveredGrantSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const g of grants) {
    counts[g.scope] = (counts[g.scope] ?? 0) + 1;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin?callbackUrl=/dashboard");
  }

  const projects = await prisma.project.findMany({
    where: {
      projectAccess: {
        some: { userId: session.user.id },
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      photos: true,
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          estimateMin: true,
          estimateMax: true,
          generatedAt: true,
        },
      },
    },
  });

  const notifications = getMockNotifications(
    projects.map((p) => ({ id: p.id, address: p.address }))
  );

  /* ---- Batch-fetch latest eligibility assessments for all projects ---- */
  const projectIds = projects.map((p) => p.id);
  const assessments = projectIds.length > 0
    ? await prisma.eligibilityAssessment.findMany({
        where: {
          projectId: { in: projectIds },
          isLatest: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const eligibilityByProject = new Map<string, ProjectEligibility>();
  for (const a of assessments) {
    if (eligibilityByProject.has(a.projectId)) continue; // already have latest
    const aExtended = a as typeof a & {
      discoveredGrants?: unknown;
      discoveryProvider?: string | null;
    };
    const grants = Array.isArray(aExtended.discoveredGrants)
      ? (aExtended.discoveredGrants as DiscoveredGrantSummary[])
      : [];
    eligibilityByProject.set(a.projectId, {
      overallDecision: a.overallDecision,
      discoveredGrants: grants,
      provider: aExtended.discoveryProvider ?? null,
      assessedAt: a.createdAt,
    });
  }

  return (
    <main className="min-h-screen bg-gray-50/60">
      {/* Dashboard header */}
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start sm:justify-between md:px-8">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Your Dashboard
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Track your home modification projects and AI-discovered grant eligibility.
            </p>
          </div>
          <div className="shrink-0 self-end sm:self-start">
            <NotificationCenter notifications={notifications} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 md:px-8">
        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
            <HomeIcon size={36} className="mx-auto text-gray-300" />
            <h2 className="mt-3 text-lg font-semibold text-gray-900">No Projects Yet</h2>
            <p className="mt-1 text-sm text-gray-500">
              Submit an intake form to start a new home modification project.
            </p>
            <Link href="/">
              <Button variant="default" className="mt-4">
                Start New Intake
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {projects.map((project) => {
              const estimateSummary = getEstimateSummary(project);
              const eligibility = eligibilityByProject.get(project.id);

              /* Score breakdown for eligible grants */
              const eligibleGrants = eligibility
                ? eligibility.discoveredGrants.filter((g) => g.decision === "ELIGIBLE")
                : [];
              const scopeCounts = eligibility
                ? countByScope(eligibility.discoveredGrants)
                : {};
              const decisionDisplay = eligibility
                ? DECISION_DISPLAY[eligibility.overallDecision] ?? DECISION_DISPLAY.MANUAL_REVIEW
                : null;

              return (
                <div
                  key={project.id}
                  className="overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow duration-200 hover:shadow-md"
                  id={`project-card-${project.id}`}
                >
                  {/* Accent bar */}
                  <div
                    className={`h-1 w-full ${
                      eligibility?.overallDecision === "ELIGIBLE"
                        ? "bg-gradient-to-r from-emerald-400 to-teal-500"
                        : eligibility?.overallDecision === "NEEDS_MORE_INFO"
                        ? "bg-gradient-to-r from-amber-400 to-orange-400"
                        : "bg-gradient-to-r from-gray-300 to-gray-400"
                    }`}
                  />

                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                      {/* Left: Project info */}
                      <div className="min-w-0 flex-1 space-y-4">
                        {/* Title + metadata */}
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{project.address}</h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getStatusStyle(
                                project.status
                              )}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  project.status === "draft" ? "bg-amber-500" : "bg-emerald-500"
                                }`}
                              />
                              {getStatusLabel(project.status)}
                            </span>
                            <span className="text-xs text-gray-500">
                              {new Date(project.createdAt).toLocaleDateString("en-CA", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <CameraIcon size={12} /> {project.photos.length} photo{project.photos.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>

                        {/* Estimate summary */}
                        <div className="rounded-lg border bg-gray-50/80 p-3.5">
                          <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                            <svg className="h-4 w-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {estimateSummary.title}: {estimateSummary.value}
                          </p>
                          <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                            {estimateSummary.explanation}
                          </p>
                        </div>

                        {/* ═══ AI-Discovered Grant Eligibility ═══ */}
                        {eligibility ? (
                          <div
                            className={`rounded-lg border p-3.5 ${decisionDisplay!.bg} ${decisionDisplay!.border}`}
                          >
                            {/* Header row */}
                            <div className="flex items-start gap-2.5">
                              <span className="text-lg leading-none mt-0.5">{decisionDisplay!.icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className={`text-sm font-bold ${decisionDisplay!.color}`}>
                                    {decisionDisplay!.label}
                                  </p>
                                  <span className="inline-flex items-center gap-1 rounded-full bg-white/80 border border-violet-200 px-2 py-0.5 text-[10px] font-medium text-violet-600">
                                    <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                    </svg>
                                    AI‑Discovered
                                  </span>
                                </div>

                                {/* Grant counts by scope */}
                                {eligibility.discoveredGrants.length > 0 ? (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {Object.entries(scopeCounts).map(([scope, count]) => (
                                      <span
                                        key={scope}
                                        className="inline-flex items-center gap-1 rounded-md bg-white/70 border border-gray-200 px-2 py-0.5 text-xs text-gray-700"
                                      >
                                        <span>{SCOPE_ICONS[scope] ?? <ClipboardIcon size={12} />}</span>
                                        {count} {scope.charAt(0) + scope.slice(1).toLowerCase()}
                                      </span>
                                    ))}
                                    {eligibleGrants.length > 0 && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                        ✓ {eligibleGrants.length} eligible
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <p className="mt-1 text-xs text-gray-600">
                                    No grant programs matched the current project profile.
                                  </p>
                                )}

                                {/* Top eligible grant preview */}
                                {eligibleGrants.length > 0 && (
                                  <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                                    Top match: <span className="font-medium text-gray-800">{eligibleGrants[0].title}</span>
                                    {eligibleGrants.length > 1 && (
                                      <span className="text-gray-500">
                                        {" "}and {eligibleGrants.length - 1} more
                                      </span>
                                    )}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Provider & date footer */}
                            <div className="mt-2.5 flex items-center gap-3 border-t border-gray-200/60 pt-2 text-[10px] text-gray-400">
                              <span>
                                Provider: {eligibility.provider === "OPENAI" ? "AI Web Search" : "Heuristic Engine"}
                              </span>
                              <span>
                                Assessed: {new Date(eligibility.assessedAt).toLocaleDateString("en-CA", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </div>
                          </div>
                        ) : (
                          /* No assessment yet — show pending state */
                          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3.5">
                            <div className="flex items-center gap-2.5">
                              <SearchIcon size={18} className="text-gray-400" />
                              <div>
                                <p className="text-sm font-medium text-gray-700">
                                  AI Grant Discovery Pending
                                </p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                  Grant eligibility will be automatically assessed once intake is finalized.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right: Action buttons */}
                      <div className="flex shrink-0 flex-col gap-2 sm:w-auto">
                        <Link href={`/dashboard/${project.id}`}>
                          <Button variant="outline" className="w-full gap-1.5 sm:w-auto">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            View Details
                          </Button>
                        </Link>

                        {project.grantDocumentKey ? (
                          <Link href={`/api/documents/${project.id}/download`} target="_blank">
                            <Button
                              variant="default"
                              className="flex w-full items-center gap-2 sm:w-auto"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>
                              Grant PDF
                            </Button>
                          </Link>
                        ) : (
                          <Button variant="outline" disabled className="w-full gap-1.5 sm:w-auto">
                            <div className="h-3.5 w-3.5 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
                            Generating PDF…
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}