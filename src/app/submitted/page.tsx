/**
 * Submission Successful landing page (FR-2.5a/b).
 *
 * Shown immediately after a client finalizes intake. Its primary job is to
 * manage expectations by explaining the two-stage estimation process:
 *   - Stage 1 (FR-2.5a): an immediate initial estimate range (min–max).
 *   - Stage 2 (FR-2.5b): a refined estimate delivered within 4–24 hours
 *     during business hours (9:00 AM – 5:00 PM EST, Mon–Fri), or by the
 *     next business day for after-hours submissions.
 */
import Link from "next/link";
import { prisma } from "lib/prisma";
import { Button } from "@/frontend/components/ui/button";
import { InitialEstimateSummaryCard } from "@/frontend/components/InitialEstimateSummaryCard";
import { getEstimateRangeFromQuote } from "@/lib/estimate-range";

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;

function getRefinedEstimateEta(now: Date = new Date()): string {
  const toronto = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Toronto" })
  );
  const day = toronto.getDay();
  const hour = toronto.getHours();

  const isWeekday = day >= 1 && day <= 5;
  const isBusinessHours =
    isWeekday && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;

  if (isBusinessHours) {
    return "within the next 4–24 business hours";
  }

  return "by the end of the next business day";
}

type SubmittedPageProps = {
  searchParams: Promise<{ projectId?: string }>;
};

export default async function SubmittedPage({ searchParams }: SubmittedPageProps) {
  const { projectId } = await searchParams;

  const project = projectId
    ? await prisma.project.findUnique({
        where: { id: projectId },
        include: {
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
      })
    : null;

  const latestQuote = project?.quotes?.[0] ?? null;
  const estimateRange = getEstimateRangeFromQuote(latestQuote);

  const eta = getRefinedEstimateEta();

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-white px-6 py-12 md:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
            Submission successful!
          </h1>
          <p className="mt-3 max-w-xl text-base text-gray-700 md:text-lg">
            Thanks for finalizing your intake. Here’s what happens next with your
            estimate — so you know exactly what to expect.
          </p>
        </div>

        {project && (
          <div className="mb-8">
            <InitialEstimateSummaryCard
              projectStatus={project.status}
              estimateMin={estimateRange?.min}
              estimateMax={estimateRange?.max}
              refinedEstimateReady={project.status === "estimate_ready"}
              projectId={project.id}
            />
          </div>
        )}

        <section
          aria-label="Two-stage estimation process"
          className="rounded-lg border bg-white p-6 shadow-sm"
        >
          <h2 className="text-xl font-semibold text-gray-900">
            Your two-stage estimate
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            We give you an instant ballpark now, then a more precise figure
            shortly after a team member reviews your photos and details.
          </p>

          <ol className="mt-6 space-y-5">
            <li className="flex gap-4">
              <div
                className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-700"
                aria-hidden="true"
              >
                1
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  Initial estimate range — available now
                </h3>
                <p className="mt-1 text-sm text-gray-700">
                  Right after you finalize your intake, we generate an automatic{" "}
                  <strong>price range (min–max)</strong> based on your selected
                  modifications and live retail pricing data. It’s a range (not a
                  single fixed price) so you always see the realistic spread.
                </p>
              </div>
            </li>

            <li className="flex gap-4">
              <div
                className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700"
                aria-hidden="true"
              >
                2
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  Refined estimate — {eta}
                </h3>
                <p className="mt-1 text-sm text-gray-700">
                  A Landseed team member reviews your submission in detail and
                  delivers a refined estimate{" "}
                  <strong>within 4–24 hours during business hours</strong>{" "}
                  (9:00 AM – 5:00 PM EST, Monday–Friday). Submissions made
                  after-hours or on weekends are refined by the{" "}
                  <strong>next business day</strong>.
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  We’ll email you and post a notification on your dashboard as
                  soon as it’s ready.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/dashboard" className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto" size="lg">
              Go to my dashboard
            </Button>
          </Link>
          {projectId && (
            <Link href={`/dashboard/${projectId}`} className="w-full sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto" size="lg">
                View this project
              </Button>
            </Link>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          Business hours are 9:00 AM – 5:00 PM EST, Monday to Friday.
        </p>
      </div>
    </main>
  );
}
