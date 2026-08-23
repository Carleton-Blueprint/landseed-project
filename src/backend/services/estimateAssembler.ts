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
import {
  resolveBuilderTrendPricingBreakdown,
  type BuilderTrendWorkOrderPricingBreakdown,
} from '@/backend/integrations/builderTrendPayload';
import type { PromoteIntakeData } from '@/backend/schemas/intakeDraft';

export interface AssembledEstimateInput {
  projectId: string;
  quoteId: string;
  clientName: string;
  projectAddress: string;
  modificationType: string;
  selectedTier: PricingTierKey | null;
  pricing: BuilderTrendWorkOrderPricingBreakdown;
  incompleteFields: string[];
  preparedAtIso: string;
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
  const selectedTier: PricingTierKey | null = quoteIsTiered
    ? (refinedEstimate as TieredRefinedEstimate).selectedTier ?? null
    : null;

  const pricing = resolveBuilderTrendPricingBreakdown({
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
  };
}
