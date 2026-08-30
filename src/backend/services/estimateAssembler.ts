import { prisma } from 'lib/prisma';
import { deriveAddressFromIntakeData } from './intakeDraft';
import { MODIFICATION_COST_CATALOG } from './modificationCostCatalog';
import { aggregateDeclaredModificationCodes } from '@/backend/eligibility/modificationNormalization';
import {
  isTieredEstimate,
  type AnyRefinedEstimate,
  type PricingTierKey,
  type TieredRefinedEstimate,
} from '@/backend/services/pricingTiers';
import type { PromoteIntakeData } from '@/backend/schemas/intakeDraft';
import type { RefinedEstimate, RefinedEstimateLineItem } from './refinedEstimate';

export interface PricingBreakdown {
  selectedTier: PricingTierKey | null;
  lineItems: RefinedEstimate['lineItems'];
  subtotal: number;
  laborTotal: number;
  markupTotal: number;
  total: number;
  estimateMin: number;
  estimateMax: number;
}

export type DecimalLike = { toString(): string } | number;

export function toNumber(value: DecimalLike): number {
  return typeof value === 'number' ? value : Number(value.toString());
}

/**
 * Prefers the accepted tier's own breakdown (tiered) or the flat
 * refinedEstimate (non-tiered) for every figure, including the header
 * totals — Quote.subtotal/total/estimateMin/estimateMax reflect whichever
 * tier the quote was originally generated with, not necessarily the tier
 * the client just accepted, so they're only a fallback when no
 * refinedEstimate breakdown is available at all. Used to build the itemized
 * Estimate PDF.
 */
export function resolvePricingBreakdown(input: {
  quote: {
    subtotal: DecimalLike;
    total: DecimalLike;
    estimateMin: DecimalLike | null;
    estimateMax: DecimalLike | null;
  };
  refinedEstimate: AnyRefinedEstimate | null;
  quoteIsTiered: boolean;
  acceptedTier: PricingTierKey | null;
}): PricingBreakdown {
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

export interface AssembledEstimateInput {
  projectId: string;
  quoteId: string;
  clientName: string;
  projectAddress: string;
  modificationType: string;
  selectedTier: PricingTierKey | null;
  pricing: PricingBreakdown;
  incompleteFields: string[];
  preparedAtIso: string;
  // FR-4.3: true once an admin has overridden this quote's pricing post-estimate.
  // Markup/estimate-range have no override-tracked equivalent (the admin only
  // enters material + labor per line and one final total), so consumers of
  // this input should omit those fields rather than show fabricated values.
  wasOverridden: boolean;
}

/**
 * Builds a PricingBreakdown from a post-estimate
 * override's simplified {description, quantity, materialTotal, laborTotal}
 * line items. Markup/unit-cost/labor-hours/rate/pricing-source have no
 * override-tracked value, so they're zeroed/nulled rather than fabricated -
 * only description/quantity/materialTotal/laborTotal (and the derived
 * lineTotal) reflect real admin-entered numbers.
 */
function buildOverriddenPricingBreakdown(override: {
  subtotal: unknown;
  total: unknown;
  lineItems: unknown;
}): PricingBreakdown {
  const overrideLineItems = (override.lineItems ?? []) as Array<{
    description: string;
    quantity: number;
    materialTotal: number;
    laborTotal: number;
  }>;

  const lineItems: RefinedEstimateLineItem[] = overrideLineItems.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    pricingQuery: item.description,
    pricingSource: null,
    pricingLink: null,
    modificationCode: null,
    modificationLabel: null,
    materialUnitCost: item.quantity > 0 ? item.materialTotal / item.quantity : 0,
    materialTotal: item.materialTotal,
    laborHours: 0,
    laborRate: 0,
    laborTotal: item.laborTotal,
    markupPercentage: 0,
    markupTotal: 0,
    lineTotal: item.materialTotal + item.laborTotal,
  }));

  const total = Number(override.total);

  return {
    selectedTier: null,
    lineItems,
    subtotal: Number(override.subtotal),
    laborTotal: lineItems.reduce((sum, item) => sum + item.laborTotal, 0),
    markupTotal: 0,
    total,
    estimateMin: total,
    estimateMax: total,
  };
}

interface DraftIntakeFields {
  name?: string;
  addressLine1?: string;
  city?: string;
  province?: string;
  postalCode?: string;
}

export async function assembleEstimateInput(quoteId: string): Promise<AssembledEstimateInput> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      projectId: true,
      subtotal: true,
      total: true,
      estimateMin: true,
      estimateMax: true,
      refinedEstimate: true,
      override: true,
      project: {
        select: {
          id: true,
          address: true,
          draftData: true,
          user: { select: { name: true } },
          photos: { select: { declaredModificationCodes: true } },
          manualModeSubmission: { select: { modificationType: true } },
        },
      },
    },
  });

  if (!quote) {
    throw new Error('Quote not found');
  }

  const project = quote.project;
  const draft = (project.draftData ?? {}) as unknown as DraftIntakeFields;
  const incompleteFields: string[] = [];

  // Client name: mirrors the same fallback chain used by grantMatchSummaryAssembler.ts
  // and grantPdfAssembler.ts.
  const clientName =
    typeof project.user?.name === 'string' && project.user.name.trim()
      ? project.user.name.trim()
      : typeof draft.name === 'string' && draft.name.trim()
      ? draft.name.trim()
      : '[Incomplete]';
  if (clientName === '[Incomplete]') incompleteFields.push('client name');

  // Address: derive from draft intake if available, otherwise project.address.
  let projectAddress = project.address ?? '';
  try {
    if (draft.addressLine1 || draft.city || draft.province || draft.postalCode) {
      const addressInput: Pick<PromoteIntakeData, 'addressLine1' | 'city' | 'province' | 'postalCode'> = {
        addressLine1: draft.addressLine1 ?? '',
        city: draft.city ?? '',
        province: (draft.province ?? '') as PromoteIntakeData['province'],
        postalCode: draft.postalCode ?? '',
      };
      projectAddress = deriveAddressFromIntakeData(addressInput);
    }
  } catch {
    // ignore and fall back to project.address
  }
  if (!projectAddress || projectAddress === '') {
    projectAddress = '[Incomplete]';
    incompleteFields.push('project address');
  }

  // Modification type: prefer photo-declared modification codes, falling back to a
  // manual-mode submission's modification type.
  const modificationCodes = aggregateDeclaredModificationCodes(project.photos);
  const modificationLabelsFromPhotos = modificationCodes.map(
    (code) => MODIFICATION_COST_CATALOG[code].label
  );
  const modificationType =
    modificationLabelsFromPhotos.length > 0
      ? modificationLabelsFromPhotos.join(', ')
      : project.manualModeSubmission?.modificationType ?? '[Incomplete]';
  if (modificationType === '[Incomplete]') incompleteFields.push('modification type');

  const refinedEstimate = quote.refinedEstimate as unknown as AnyRefinedEstimate | null;
  const quoteIsTiered = !!refinedEstimate && isTieredEstimate(refinedEstimate);

  // A post-estimate override (FR-4.3) collapses tiered AI pricing to one flat
  // figure - the tier breakdown it replaced is no longer what was approved.
  const selectedTier: PricingTierKey | null = quote.override
    ? null
    : quoteIsTiered
    ? (refinedEstimate as TieredRefinedEstimate).selectedTier ?? null
    : null;

  const pricing = quote.override
    ? buildOverriddenPricingBreakdown(quote.override)
    : resolvePricingBreakdown({
        quote: {
          subtotal: quote.subtotal,
          total: quote.total,
          estimateMin: quote.estimateMin,
          estimateMax: quote.estimateMax,
        },
        refinedEstimate,
        quoteIsTiered,
        acceptedTier: selectedTier,
      });

  return {
    projectId: project.id,
    quoteId: quote.id,
    clientName,
    projectAddress,
    modificationType,
    selectedTier,
    pricing,
    incompleteFields,
    preparedAtIso: new Date().toISOString(),
    wasOverridden: !!quote.override,
  };
}
