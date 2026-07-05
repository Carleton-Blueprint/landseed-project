import { prisma } from "lib/prisma";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";
import { auth } from "@/auth";
import { redirectToSignIn } from "lib/auth-redirect";
import { getEstimateRangeFromQuote } from "@/lib/estimate-range";

export const metadata = {
  title: "Project Tracker — Landseed",
  description: "Track your home modification projects and InPlace AI-discovered grant eligibility.",
};
import {
  NotificationCenter,
  NotificationItem,
} from "@/frontend/components/NotificationCenter";
import {
  DashboardProjectsClient,
  DashboardProjectItem,
} from "@/frontend/components/dashboard/DashboardProjectsClient";
import { AlertCircle } from "lucide-react";
import { EmailVerificationBanner } from "@/frontend/components/auth/EmailVerificationBanner";
import { isDevAuthBypassEnabled } from "@/backend/auth/devBypass";


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
      value: "Available after project finalization",
      explanation:
        "Once your project request is finalized, an initial estimate range will appear here. Pricing is dynamically generated from real-time external retail data.",
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
function getMockNotifications(projects: { id: string; address: string; status: string }[]): NotificationItem[] {
  const now = Date.now();
  const first = projects[0];
  const items: NotificationItem[] = [];

  if (first) {
    if (first.status === "estimate_ready") {
      items.push({
        id: `mock-estimate-approval-${first.id}`,
        kind: "action_required",
        title: "Estimate Awaiting Approval",
        body: `Your final estimate for ${first.address} requires your approval to proceed to the next steps.`,
        href: `/projects/${first.id}/estimate`,
        createdAt: new Date(now - 1000 * 60 * 5).toISOString(),
        urgent: true,
      });
    }

    items.push({
      id: `mock-docs-${first.id}`,
      kind: "documents_requested",
      title: "Supporting documents requested",
      body: "Please upload proof of income and property ownership to continue your grant application.",
      href: `/dashboard/${first.id}`,
      createdAt: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
      urgent: true,
    });
    
    items.push({
      id: `mock-estimate-${first.id}`,
      kind: "estimate_ready",
      title: "Refined estimate ready for review",
      body: `Your refined estimate for ${first.address} is ready. Review the updated pricing and grant details.`,
      href: `/dashboard/${first.id}`,
      createdAt: new Date(now - 1000 * 60 * 12).toISOString(),
    });
  }

  items.push({
    id: "mock-welcome",
    kind: "info",
    title: "Welcome to Landseed",
    body: "You can track every project you submit from this dashboard.",
    createdAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
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


/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

type DashboardPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedParams = searchParams ? await searchParams : {};
  const activeTabParam = typeof resolvedParams?.tab === "string" ? resolvedParams.tab : "all";
  const initialTab =
    activeTabParam === "submitted" || activeTabParam === "draft" || activeTabParam === "all"
      ? activeTabParam
      : "all";
  const isSubmitted = resolvedParams?.submitted === "true";
  const newProjectId =
    typeof resolvedParams?.projectId === "string" ? resolvedParams.projectId : null;

  const session = await auth();
  if (!session?.user?.id) {
    redirectToSignIn("/dashboard");
  }

  let accountEmail: string | null = null;
  let needsEmailVerification = false;

  try {
    const account = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, emailVerified: true },
    });
    accountEmail = account?.email ?? null;
    needsEmailVerification = Boolean(
      accountEmail && !account?.emailVerified && !isDevAuthBypassEnabled()
    );
  } catch {
    // No DB in dev — skip verification banner
  }

  let projects: Awaited<
    ReturnType<
      typeof prisma.project.findMany<{
        include: {
          photos: true;
          quotes: {
            orderBy: { createdAt: "desc" };
            take: 1;
            select: {
              estimateMin: true;
              estimateMax: true;
              generatedAt: true;
            };
          };
        };
      }>
    >
  > = [];
  const eligibilityByProject = new Map<string, ProjectEligibility>();

  try {
    projects = await prisma.project.findMany({
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

    const projectIds = projects.map((p) => p.id);
    const assessments =
      projectIds.length > 0
        ? await prisma.eligibilityAssessment.findMany({
            where: { projectId: { in: projectIds }, isLatest: true },
            orderBy: { createdAt: "desc" },
          })
        : [];

    for (const a of assessments) {
      if (eligibilityByProject.has(a.projectId)) continue;
      const aExtended = a as typeof a & {
        discoveredGrants?: unknown;
        discoveryProvider?: string | null;
      };
      eligibilityByProject.set(a.projectId, {
        overallDecision: a.overallDecision,
        discoveredGrants: Array.isArray(aExtended.discoveredGrants)
          ? (aExtended.discoveredGrants as DiscoveredGrantSummary[])
          : [],
        provider: aExtended.discoveryProvider ?? null,
        assessedAt: a.createdAt,
      });
    }
  } catch {
    // No DB in dev — renders empty dashboard
  }

  const notifications = getMockNotifications(
    projects.map((p) => ({ id: p.id, address: p.address, status: p.status }))
  );

  const projectItems: DashboardProjectItem[] = projects.map((project) => {
    const estimateSummary = getEstimateSummary(project);
    const eligibility = eligibilityByProject.get(project.id);

    return {
      id: project.id,
      address: project.address,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      photoCount: project.photos.length,
      grantDocumentKey: project.grantDocumentKey,
      estimateSummary: {
        title: estimateSummary.title,
        value: estimateSummary.value,
        explanation: estimateSummary.explanation,
      },
      eligibility: eligibility
        ? {
            overallDecision: eligibility.overallDecision,
            discoveredGrants: eligibility.discoveredGrants.map((g) => ({
              grantId: g.grantId,
              title: g.title,
              scope: g.scope,
              decision: g.decision,
              relevanceScore: g.relevanceScore,
              confidence: g.confidence,
            })),
            provider: eligibility.provider,
            assessedAt: eligibility.assessedAt.toISOString(),
          }
        : null,
    };
  });

  return (
    <main className="relative min-h-screen bg-gray-50 z-0 overflow-hidden">
      <style>{`
        @keyframes drift-1 {
          from { background-position: 0 0; }
          to { background-position: 200px -200px; }
        }
        @keyframes drift-2 {
          from { background-position: 0 0; }
          to { background-position: -300px 300px; }
        }
        .bg-houses-1 {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='0.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3Cpolyline points='9 22 9 12 15 12 15 22'/%3E%3C/svg%3E");
          background-size: 200px 200px;
          animation: drift-1 50s linear infinite;
        }
        .bg-houses-2 {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='%2310b981' opacity='0.15' stroke='none'%3E%3Cpath d='m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3C/svg%3E");
          background-size: 300px 300px;
          animation: drift-2 70s linear infinite;
        }
      `}</style>
      
      {/* Background Layers */}
      <div className="fixed inset-0 -z-10 bg-houses-1 opacity-20 pointer-events-none" />
      <div className="fixed inset-0 -z-10 bg-houses-2 opacity-50 pointer-events-none" />


      {/* Dashboard header */}
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start sm:justify-between md:px-8">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Project Tracker
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Track your home modification projects and InPlace AI-discovered grant eligibility.
            </p>
          </div>
          <div className="shrink-0 self-end sm:self-start">
            <NotificationCenter notifications={notifications} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 md:px-8">
        {needsEmailVerification && accountEmail && (
          <EmailVerificationBanner email={accountEmail} />
        )}
        {(() => {
          const urgentItems = notifications.filter((n) => n.urgent && !n.read);
          if (urgentItems.length === 0) return null;
          return (
            <div className="mb-8 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">Action Items & Updates</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {urgentItems.map((item) => (
                  <div key={item.id} className="relative rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm flex gap-3">
                    <div className="mt-0.5 shrink-0 text-red-600">
                      <AlertCircle size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-red-900">{item.title}</h3>
                      <p className="mt-1 text-sm text-red-800">{item.body}</p>
                      {item.href && (
                        <div className="mt-3">
                          <Link href={item.href}>
                            <Button size="sm" variant="default" className="bg-red-600 hover:bg-red-700 text-white">
                              Take Action
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <DashboardProjectsClient
          projects={projectItems}
          initialTab={initialTab}
          isSubmitted={isSubmitted}
          newProjectId={newProjectId}
        />
      </div>
    </main>
  );
}