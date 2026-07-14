import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";
import { prisma } from "lib/prisma";
import { getSignedDownloadUrlFromS3Url } from "lib/s3";
import { auth } from "@/auth";
import { redirectToSignIn } from "lib/auth-redirect";
import { getEstimateRangeFromQuote } from "@/lib/estimate-range";
import { ProjectVisualizationGallery } from "./ProjectVisualizationGallery";
import { GrantDiscoverySummary } from "./GrantDiscoverySummary";
import { SupportingDocumentsSection } from "./SupportingDocumentsSection";
import { generateMockAccessibilityVisual } from "@/backend/services/imageGeneration";
import { ConsultationScheduler } from "@/frontend/components/ConsultationScheduler";
import { getLatestGrantDocumentGenerationInfo } from "@/backend/services/grantDocument";
import { GrantDocumentCard } from "./GrantDocumentCard";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getStatusLabel(status: string) {
  if (status === "draft") return "Pending Review";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusStyle(status: string) {
  if (status === "draft")
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "submitted")
    return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

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
      value: "Available after project finalization",
      explanation:
        "Your initial estimate range will appear here after your project request is finalized. Pricing is dynamically generated from real-time external retail data.",
    };
  }

  if (estimateRange) {
    return {
      value: `$${estimateRange.min.toLocaleString()} – $${estimateRange.max.toLocaleString()}`,
      explanation:
        "This pricing is dynamically generated from real-time external retail data and may change as retailer pricing and product availability update.",
    };
  }

  return {
    value: "Generating estimate…",
    explanation:
      "We are generating your estimate using real-time external retail data.",
  };
}

function modificationItemsFromDraft(draftData: unknown): string[] {
  if (!draftData || typeof draftData !== "object" || Array.isArray(draftData)) {
    return [];
  }
  const raw = (draftData as Record<string, unknown>).modificationItems;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

/* ------------------------------------------------------------------ */
/* Modification codes → human-readable labels                         */
/* ------------------------------------------------------------------ */

const MODIFICATION_LABELS: Record<string, { label: string; icon: string }> = {
  GRAB_BARS: { label: "Grab Bars", icon: "GB" },
  RAISED_TOILET: { label: "Raised Toilet", icon: "RT" },
  WALK_IN_SHOWER: { label: "Walk-In Shower", icon: "WS" },
  WIDENED_DOORWAY: { label: "Widened Doorway", icon: "WD" },
  STAIR_LIFT: { label: "Stair Lift", icon: "SL" },
  HANDRAILS: { label: "Handrails", icon: "HR" },
};

function getModLabel(item: string) {
  const entry = MODIFICATION_LABELS[item];
  if (entry) return entry;
  return {
    label: item
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: "CM",
  };
}

/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const session = await auth();

  if (!session?.user?.id) {
    redirectToSignIn(`/dashboard/${resolvedParams.id}`);
  }

  let project = null;
  try {
    project = await prisma.project.findUnique({
      where: { id: resolvedParams.id },
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
        projectAccess: {
          where: { userId: session.user.id },
          select: { userId: true },
        },
      },
    });
  } catch {
    if (process.env.NODE_ENV === "development") {
      project = {
        id: resolvedParams.id,
        address: "123 Dev Lane, Mockville",
        status: "submitted",
        userId: "dev-user-id",
        createdAt: new Date(),
        updatedAt: new Date(),
        draftData: {
          modificationItems: ["GRAB_BARS", "WALK_IN_SHOWER", "STAIR_LIFT"],
        },
        photos: [
          {
            id: "photo-1",
            url: "https://placehold.co/800x600?text=Original+Bathroom",
          }
        ],
        projectAccess: [
          { userId: "dev-user-id" }
        ],
        grantDocumentKey: "mock-key",
      };
    }
  }

  if (!project) return notFound();
  if (project.projectAccess.length === 0) return notFound();

  const modificationItems = modificationItemsFromDraft(project.draftData);

  const estimateSummary = getEstimateSummary({ status: project.status, quotes: project.quotes });

  let grantDocumentInfo: { generatedAt: Date; incompleteFields: string[] } | null = null;
  try {
    grantDocumentInfo = await getLatestGrantDocumentGenerationInfo(project.id);
  } catch (error) {
    console.warn("Failed to load grant document generation info:", error);
  }

  let photosWithSignedUrls: { id: string; imageUrl: string | null; generatedImageUrl: string | null }[] = [];
  try {
    photosWithSignedUrls = await Promise.all(
      project.photos.map(async (photo) => {
        const imageUrl = "imageUrl" in photo
          ? ((photo as { imageUrl?: string | null }).imageUrl ?? photo.url)
          : photo.url;

        const existingGeneratedImageUrl = "generatedImageUrl" in photo
          ? ((photo as { generatedImageUrl?: string | null }).generatedImageUrl ?? null)
          : null;

        const generatedImageUrl = existingGeneratedImageUrl ??
          (await generateMockAccessibilityVisual(photo.url, {
            modificationCodes: modificationItems,
          }));

        const signedImageUrl = imageUrl?.includes(".amazonaws.com")
          ? await getSignedDownloadUrlFromS3Url(imageUrl, 900)
          : imageUrl;

        const signedGeneratedImageUrl = generatedImageUrl?.includes(".amazonaws.com")
          ? await getSignedDownloadUrlFromS3Url(generatedImageUrl, 900)
          : generatedImageUrl;

        return {
          id: photo.id,
          imageUrl: signedImageUrl,
          generatedImageUrl: signedGeneratedImageUrl,
        };
      })
    );
  } catch {
    photosWithSignedUrls = project.photos.map((photo) => ({
      id: photo.id,
      imageUrl: photo.url,
      generatedImageUrl: photo.url,
    }));
  }

  return (
    <main className="min-h-screen bg-gray-50/60">
      {/* Top navigation bar */}
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-3 md:px-8">
          <Link href="/dashboard">
            <Button variant="ghost" className="gap-1.5 text-gray-600 hover:text-gray-900">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Dashboard
            </Button>
          </Link>
          <span className="text-sm text-gray-400">/</span>
          <span className="text-sm font-medium text-gray-700 truncate">{project.address}</span>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-6 md:px-8 md:py-8 space-y-6">
        {/* ═══════ Project Header Card ═══════ */}
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                {project.address}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${getStatusStyle(
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
                <span className="text-sm text-gray-500">
                  Submitted {new Date(project.createdAt).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}
                </span>
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex gap-2">
              <Link href={`/projects/${project.id}/documents`}>
                <Button variant="outline" className="gap-1.5 text-sm">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  Documents
                </Button>
              </Link>
              <Link href={`/projects/${project.id}/estimate`}>
                <Button variant="outline" className="gap-1.5 text-sm">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                  </svg>
                  Estimate
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* ═══════ Estimate Summary ═══════ */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Initial Estimate Range
          </h2>
          <p className="text-xl font-bold text-gray-800">{estimateSummary.value}</p>
          <p className="mt-2 text-sm text-gray-500">{estimateSummary.explanation}</p>
        </div>

        {/* ═══════ Modification Items ═══════ */}
        {modificationItems.length > 0 && (
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.16 3.045a.75.75 0 01-1.12-.66V5.847a.75.75 0 01.355-.64l5.16-3.045a.75.75 0 01.73 0l5.165 3.046a.75.75 0 01.354.638v.424m-8.649 3.477l8.649-3.477m0 0l-8.649 3.477M3.69 8.346L12 12.124l8.31-3.778" />
              </svg>
              Requested Modifications
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
              {modificationItems.map((item) => {
                const mod = getModLabel(item);
                return (
                  <div
                    key={item}
                    className="flex items-center gap-2.5 rounded-lg border bg-gray-50 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    <span className="text-lg">{mod.icon}</span>
                    <span className="font-medium">{mod.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══════ Space Visualizations (Original / AI / Compare) ═══════ */}
        <ProjectVisualizationGallery
          photos={photosWithSignedUrls}
        />

        {/* ═══════ AI-Sourced Grant Discovery Summary ═══════ */}
        <GrantDiscoverySummary projectId={project.id} />

        {/* ═══════ Mandatory Consultation Scheduler ═══════ */}
        {project.status !== "draft" && (
          <ConsultationScheduler projectId={project.id} />
        )}

        <SupportingDocumentsSection grantApplicationId={project.id} />

        {/* ═══════ Grant PDF Download Card ═══════ */}
        <GrantDocumentCard
          projectId={project.id}
          hasDocument={Boolean(project.grantDocumentKey)}
          lastGeneratedAt={grantDocumentInfo?.generatedAt.toISOString() ?? null}
          incompleteFields={grantDocumentInfo?.incompleteFields ?? []}
        />
      </div>
    </main>
  );
}