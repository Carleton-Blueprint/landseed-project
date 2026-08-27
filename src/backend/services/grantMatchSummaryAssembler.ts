import { prisma } from 'lib/prisma';
import { deriveAddressFromIntakeData } from './intakeDraft';
import { MODIFICATION_COST_CATALOG } from './modificationCostCatalog';
import { aggregateDeclaredModificationCodes } from '@/backend/eligibility/modificationNormalization';
import { outputSourceForDiscoveryProvider } from '@/backend/eligibility/service';
import { DiscoveredGrant, GrantDiscoveryMetadata } from '@/backend/eligibility/discoverySearchProvider';
import { EligibilityDecision } from '@/backend/eligibility/types';
import type { AiOutputSource } from '@/backend/audit/aiProvenance';
import type { PromoteIntakeData } from '@/backend/schemas/intakeDraft';
import { applyGrantOverridesToRawGrants, type GrantOverrides } from '@/backend/services/quoteOverride';

export interface AssembledMatchedGrant {
  programName: string;
  eligibilityStatus: 'ELIGIBLE';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  estimatedFunding: string | null;
  scopeDescription: string;
}

export interface AssembledGrantMatchSummaryInput {
  projectId: string;
  eligibilityAssessmentId: string;
  clientName: string;
  projectAddress: string;
  modificationType: string;
  assessmentDate: string;
  outputSource: AiOutputSource;
  matchedGrants: AssembledMatchedGrant[];
  hasMatches: boolean;
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

function resolveOutputSource(provider: string | null): AiOutputSource {
  if (provider === 'OPENAI' || provider === 'HEURISTIC' || provider === 'MOCK' || provider === 'MANUAL') {
    return outputSourceForDiscoveryProvider(provider as GrantDiscoveryMetadata['provider']);
  }
  return 'NONE';
}

export async function assembleGrantMatchSummaryInput(
  projectId: string
): Promise<AssembledGrantMatchSummaryInput> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      address: true,
      draftData: true,
      photos: { select: { declaredModificationCodes: true } },
      user: { select: { name: true } },
      manualModeSubmission: { select: { modificationType: true } },
      eligibilityAssessments: {
        where: { isLatest: true },
        take: 1,
        select: { id: true, createdAt: true, discoveredGrants: true, discoveryProvider: true },
      },
      quotes: {
        orderBy: { generatedAt: 'desc' },
        take: 1,
        select: { eligibilityAssessmentId: true, override: true },
      },
    },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  const assessment = project.eligibilityAssessments[0];
  if (!assessment) {
    throw new Error('No eligibility assessment found for project');
  }

  const draft = (project.draftData ?? {}) as unknown as DraftIntakeFields;
  const incompleteFields: string[] = [];

  // Client name
  const clientName =
    typeof project.user?.name === 'string' && project.user.name.trim()
      ? project.user.name.trim()
      : typeof draft.name === 'string' && draft.name.trim()
      ? draft.name.trim()
      : '[Incomplete]';
  if (clientName === '[Incomplete]') incompleteFields.push('client name');

  // Address: derive from draft intake if available, otherwise project.address
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
  // manual-mode submission's modification type (see grantPdfAssembler.ts for the
  // same fallback chain used by the individual grant application PDF).
  const modificationCodes = aggregateDeclaredModificationCodes(project.photos);
  const modificationLabelsFromPhotos = modificationCodes.map(
    (code) => MODIFICATION_COST_CATALOG[code].label
  );
  const modificationType =
    modificationLabelsFromPhotos.length > 0
      ? modificationLabelsFromPhotos.join(', ')
      : project.manualModeSubmission?.modificationType ?? '[Incomplete]';
  if (modificationType === '[Incomplete]') incompleteFields.push('modification type');

  // A post-estimate override (FR-4.3) may have added/removed/re-decided
  // grants since this assessment ran; only apply it when the project's
  // latest quote still points at this exact assessment (a manual AI re-run
  // after the quote would otherwise mismatch the override's grant ids).
  const latestQuote = project.quotes?.[0];
  const override = latestQuote?.eligibilityAssessmentId === assessment.id ? latestQuote.override : null;

  const rawDiscoveredGrants = (assessment.discoveredGrants ?? []) as unknown as DiscoveredGrant[];
  const discoveredGrants = applyGrantOverridesToRawGrants(
    rawDiscoveredGrants,
    (override?.grantOverrides as unknown as GrantOverrides) ?? null
  );
  const matchedGrants: AssembledMatchedGrant[] = discoveredGrants
    .filter((grant) => grant.decision === EligibilityDecision.ELIGIBLE)
    .map((grant) => ({
      programName: grant.title,
      eligibilityStatus: 'ELIGIBLE' as const,
      confidence: grant.confidence,
      estimatedFunding: grant.estimatedFundingAmount ?? null,
      scopeDescription: grant.summary,
    }));

  return {
    projectId: project.id,
    eligibilityAssessmentId: assessment.id,
    clientName,
    projectAddress,
    modificationType,
    assessmentDate: assessment.createdAt.toISOString(),
    outputSource: resolveOutputSource(assessment.discoveryProvider),
    matchedGrants,
    hasMatches: matchedGrants.length > 0,
    incompleteFields,
    preparedAtIso: new Date().toISOString(),
  };
}
