import type { RefinedEstimate } from "@/backend/services/refinedEstimate";
import type { AnyRefinedEstimate, PricingTierKey, TieredRefinedEstimate } from "@/backend/services/pricingTiers";
import { signPhotosForDisplay } from "lib/photoUrls";
import { getSignedDownloadUrl } from "lib/s3";
import { MODIFICATION_COST_CATALOG } from "@/backend/services/modificationCostCatalog";
import { aggregateDeclaredModificationCodes } from "@/backend/eligibility/modificationNormalization";
import { getOrGenerateReadyGrantMatchSummary } from "@/backend/services/grantMatchSummaryDocument";

const GRANT_MATCH_SUMMARY_ATTACHMENT_URL_TTL_SECONDS = 3600;

/**
 * Internal, provisional contract for "the format required for BuilderTrend
 * work order creation." No real BuilderTrend account/API access exists in
 * this project yet (see IMPLEMENTATION-PLAN.md), so this shape is our own
 * best-guess packaging rather than one sourced from BuilderTrend's docs.
 * `buildBuilderTrendWorkOrderPayload` is the only place that maps our data
 * onto it — when real API docs/credentials land, only this function and
 * `BuilderTrendWorkOrderPayload` need to change, not its callers.
 */
export const BUILDER_TREND_WORK_ORDER_PAYLOAD_SCHEMA_VERSION = 1 as const;

export interface BuilderTrendWorkOrderPhoto {
  id: string;
  url: string;
}

export interface BuilderTrendWorkOrderAttachment {
  label: string;
  url: string;
}

export interface BuilderTrendWorkOrderPricingBreakdown {
  selectedTier: PricingTierKey | null;
  lineItems: RefinedEstimate["lineItems"];
  subtotal: number;
  laborTotal: number;
  markupTotal: number;
  total: number;
  estimateMin: number;
  estimateMax: number;
}

export interface BuilderTrendWorkOrderPayload {
  schemaVersion: typeof BUILDER_TREND_WORK_ORDER_PAYLOAD_SCHEMA_VERSION;
  project: {
    id: string;
    address: string;
  };
  client: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  modificationType: string[];
  quote: {
    id: string;
    approvedAt: string;
    pricing: BuilderTrendWorkOrderPricingBreakdown;
  };
  photos: BuilderTrendWorkOrderPhoto[];
  attachments?: BuilderTrendWorkOrderAttachment[];
}

type DecimalLike = { toString(): string } | number;

function toNumber(value: DecimalLike): number {
  return typeof value === "number" ? value : Number(value.toString());
}

/**
 * Prefers the accepted tier's own breakdown (tiered) or the flat
 * refinedEstimate (non-tiered) for every figure, including the header
 * totals — Quote.subtotal/total/estimateMin/estimateMax reflect whichever
 * tier the quote was originally generated with, not necessarily the tier
 * the client just accepted, so they're only a fallback when no
 * refinedEstimate breakdown is available at all.
 */
export function resolveBuilderTrendPricingBreakdown(input: {
  quote: {
    subtotal: DecimalLike;
    total: DecimalLike;
    estimateMin: DecimalLike | null;
    estimateMax: DecimalLike | null;
  };
  refinedEstimate: AnyRefinedEstimate | null;
  quoteIsTiered: boolean;
  acceptedTier: PricingTierKey | null;
}): BuilderTrendWorkOrderPricingBreakdown {
  const { quote, refinedEstimate, quoteIsTiered, acceptedTier } = input;

  const flatEstimate: RefinedEstimate | null =
    acceptedTier && quoteIsTiered && refinedEstimate
      ? (refinedEstimate as TieredRefinedEstimate).tiers[acceptedTier]
      : !quoteIsTiered && refinedEstimate
        ? (refinedEstimate as RefinedEstimate)
        : null;

  if (flatEstimate) {
    return {
      selectedTier: acceptedTier,
      lineItems: flatEstimate.lineItems,
      subtotal: flatEstimate.subtotal,
      laborTotal: flatEstimate.laborTotal,
      markupTotal: flatEstimate.markupTotal,
      total: flatEstimate.total,
      estimateMin: flatEstimate.estimateMin,
      estimateMax: flatEstimate.estimateMax,
    };
  }

  const subtotal = toNumber(quote.subtotal);
  const total = toNumber(quote.total);

  return {
    selectedTier: acceptedTier,
    lineItems: [],
    subtotal,
    laborTotal: 0,
    markupTotal: 0,
    total,
    estimateMin: quote.estimateMin != null ? toNumber(quote.estimateMin) : subtotal,
    estimateMax: quote.estimateMax != null ? toNumber(quote.estimateMax) : total,
  };
}

export async function buildBuilderTrendWorkOrderPayload(input: {
  project: {
    id: string;
    address: string;
    user: { name: string | null; email: string | null; phone: string | null };
    photos: Array<{ id: string; url: string; declaredModificationCodes: string[] }>;
  };
  quote: { id: string; subtotal: DecimalLike; total: DecimalLike; estimateMin: DecimalLike | null; estimateMax: DecimalLike | null };
  approvedAt: Date;
  refinedEstimate: AnyRefinedEstimate | null;
  quoteIsTiered: boolean;
  acceptedTier: PricingTierKey | null;
  /** Used only to attribute on-demand Grant Match Summary generation if none is READY yet. */
  actorUserId: string;
}): Promise<BuilderTrendWorkOrderPayload> {
  const signedPhotos = await signPhotosForDisplay(input.project.photos);
  const attachments = await buildGrantMatchSummaryAttachments(input.project.id, input.actorUserId);

  return {
    schemaVersion: BUILDER_TREND_WORK_ORDER_PAYLOAD_SCHEMA_VERSION,
    project: {
      id: input.project.id,
      address: input.project.address,
    },
    client: {
      name: input.project.user.name,
      email: input.project.user.email,
      phone: input.project.user.phone,
    },
    modificationType: aggregateDeclaredModificationCodes(input.project.photos).map(
      (code) => MODIFICATION_COST_CATALOG[code].label
    ),
    quote: {
      id: input.quote.id,
      approvedAt: input.approvedAt.toISOString(),
      pricing: resolveBuilderTrendPricingBreakdown({
        quote: input.quote,
        refinedEstimate: input.refinedEstimate,
        quoteIsTiered: input.quoteIsTiered,
        acceptedTier: input.acceptedTier,
      }),
    },
    photos: signedPhotos.map((photo) => ({ id: photo.id, url: photo.url })),
    attachments,
  };
}

/**
 * Best-effort: a missing/failed Grant Match Summary must never block quote
 * acceptance from creating the BuilderTrend work order payload, so this
 * swallows generation failures and simply omits the attachment.
 */
async function buildGrantMatchSummaryAttachments(
  projectId: string,
  actorUserId: string
): Promise<BuilderTrendWorkOrderAttachment[]> {
  const summary = await getOrGenerateReadyGrantMatchSummary(projectId, actorUserId);
  if (!summary) {
    return [];
  }

  try {
    const url = await getSignedDownloadUrl(summary.s3Key, GRANT_MATCH_SUMMARY_ATTACHMENT_URL_TTL_SECONDS);
    return [{ label: "Grant Match Summary", url }];
  } catch (error) {
    console.warn("Failed to sign Grant Match Summary download URL for BuilderTrend payload", projectId, error);
    return [];
  }
}
