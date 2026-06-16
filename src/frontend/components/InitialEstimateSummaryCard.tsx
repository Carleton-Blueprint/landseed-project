/**
 * InitialEstimateSummaryCard (FR-8.1): an at-a-glance card that surfaces the
 * initial price range generated immediately after intake finalization, and
 * communicates whether the refined estimate (FR-2.5b) is still in progress.
 */
import Link from "next/link";
import { Button } from "@/frontend/components/ui/button";

type InitialEstimateSummaryCardProps = {
  projectStatus: string;
  estimateMin?: number | null;
  estimateMax?: number | null;
  refinedEstimateReady?: boolean;
  projectId?: string;
  className?: string;
  compact?: boolean;
};

function formatCurrency(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function getEstimateState({
  projectStatus,
  estimateMin,
  estimateMax,
}: Pick<
  InitialEstimateSummaryCardProps,
  "projectStatus" | "estimateMin" | "estimateMax"
>) {
  const isFinalized = projectStatus !== "draft";

  if (!isFinalized) {
    return {
      label: "Pending finalization",
      value: "Available after project finalization",
      helper:
        "Your initial estimate range will appear here once you finalize your project request. Ranges are generated from real-time retail pricing data.",
      tone: "pending" as const,
    };
  }

  if (estimateMin != null && estimateMax != null) {
    return {
      label: "Initial estimate range",
      value: `${formatCurrency(estimateMin)} – ${formatCurrency(estimateMax)}`,
      helper:
        "This is your immediate ballpark range. A refined, more precise estimate is being prepared and will replace this card when ready.",
      tone: "ready" as const,
    };
  }

  return {
    label: "Initial estimate range",
    value: "Generating estimate…",
    helper:
      "We’re generating your initial price range from real-time retail data. This usually takes only a few moments.",
    tone: "generating" as const,
  };
}

const toneStyles = {
  pending: "border-amber-200 bg-amber-50",
  ready: "border-emerald-200 bg-emerald-50",
  generating: "border-blue-200 bg-blue-50",
} as const;

const badgeStyles = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  ready: "bg-emerald-100 text-emerald-800 border-emerald-200",
  generating: "bg-blue-100 text-blue-800 border-blue-200",
} as const;

export function InitialEstimateSummaryCard({
  projectStatus,
  estimateMin,
  estimateMax,
  refinedEstimateReady = false,
  projectId,
  className = "",
  compact = false,
}: InitialEstimateSummaryCardProps) {
  const state = getEstimateState({ projectStatus, estimateMin, estimateMax });

  const refinedLabel = refinedEstimateReady
    ? "Refined estimate ready"
    : "Refined estimate in progress";

  return (
    <section
      aria-label="Initial estimate summary"
      className={`rounded-lg border shadow-sm ${toneStyles[state.tone]} ${
        compact ? "p-4" : "p-5"
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            {state.label}
          </p>
          <p
            className={`mt-1 font-bold text-gray-900 ${
              compact ? "text-xl" : "text-2xl md:text-3xl"
            }`}
          >
            {state.value}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badgeStyles[state.tone]}`}
        >
          {state.tone === "ready" ? "At a glance" : "Pending"}
        </span>
      </div>

      <p className="mt-3 text-sm text-gray-700">{state.helper}</p>

      {state.tone === "ready" && (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              refinedEstimateReady ? "bg-emerald-500" : "bg-blue-500 animate-pulse"
            }`}
            aria-hidden="true"
          />
          <span>{refinedLabel}</span>
        </div>
      )}

      {projectId && !compact && (
        <div className="mt-4">
          <Link href={`/dashboard/${projectId}`}>
            <Button variant="outline" size="sm">
              View project details
            </Button>
          </Link>
        </div>
      )}
    </section>
  );
}
