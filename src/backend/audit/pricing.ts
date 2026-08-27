import { logAuditEventNonBlocking } from '@/backend/audit/log';
import type { AiOutputSource } from '@/backend/audit/aiProvenance';

export interface PricingAuditSourceReference {
  sourceType: 'DISCOVERY_GRANT_SOURCE';
  sourceId?: string;
  title?: string;
  jurisdiction?: string;
  scope?: string;
  sourceUrl?: string | null;
}

export interface PricingAuditAiOutput {
  provider: 'OPENAI' | 'HEURISTIC' | 'MOCK' | 'MANUAL' | 'UNKNOWN';
  overallDecision?: string;
  rationaleSummary?: string;
  resultCount?: number;
  consideredPrograms?: Array<{
    grantId: string;
    decision?: string;
    relevanceScore?: number;
    rationale?: string;
    sourceUrl?: string | null;
  }>;
  rawDiscoveryMetadata?: unknown;
}

export interface PricingDecisionAuditInput {
  projectId: string;
  quoteId: string;
  actorUserId?: string | null;
  subtotal: number;
  total: number;
  // Flat call-out (dispatch) fee amount charged on this quote — a fixed
  // baseline (see laborRates.ts's CALL_OUT_FEE), not SerpAPI/AI-derived, so
  // it's recorded separately for audit clarity. Defaults to 0.
  calloutFeeAmount?: number;
  eligibilityAssessmentId?: string;
  discoveryVersion?: {
    engineVersion?: string;
    promptVersion?: string;
    scoringVersion?: string;
    modelVersion?: string;
    sourceSnapshotId?: string | null;
  };
  aiOutput?: PricingAuditAiOutput;
  externalSources?: PricingAuditSourceReference[];
  pricingSource: 'serp_api' | 'serp_api_partial';
  fallbackLineItems?: Array<{ description: string; query: string; fallbackUnitPrice: number; reason?: string }>;
}

export interface PricingDecisionAuditMetadata {
  pricing: {
    subtotal: number;
    total: number;
    calloutFeeAmount: number;
  };
  eligibilityAssessmentId: string | null;
  discoveryVersion: {
    engineVersion?: string;
    promptVersion?: string;
    scoringVersion?: string;
    modelVersion?: string;
    sourceSnapshotId?: string | null;
  } | null;
  aiOutput: PricingAuditAiOutput | null;
  externalSources: PricingAuditSourceReference[];
  externalSourceCount: number;
  pricingSource: 'serp_api' | 'serp_api_partial' | null;
  fallbackLineItems: Array<{ description: string; query: string; fallbackUnitPrice: number; reason?: string }>;
  outputSource: AiOutputSource | null;
  isFallback: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizePricingDecisionAuditMetadata(
  metadata: unknown
): PricingDecisionAuditMetadata | null {
  const record = asRecord(metadata);
  if (!record) return null;

  const pricing = asRecord(record.pricing);
  if (!pricing) return null;

  const externalSources = Array.isArray(record.externalSources)
    ? (record.externalSources as PricingAuditSourceReference[])
    : [];

  return {
    pricing: {
      subtotal: typeof pricing.subtotal === 'number' ? pricing.subtotal : 0,
      total: typeof pricing.total === 'number' ? pricing.total : 0,
      calloutFeeAmount: typeof pricing.calloutFeeAmount === 'number' ? pricing.calloutFeeAmount : 0,
    },
    eligibilityAssessmentId:
      typeof record.eligibilityAssessmentId === 'string'
        ? record.eligibilityAssessmentId
        : null,
    discoveryVersion:
      asRecord(record.discoveryVersion) as PricingDecisionAuditMetadata['discoveryVersion'],
    aiOutput: asRecord(record.aiOutput) as PricingAuditAiOutput | null,
    externalSources,
    externalSourceCount:
      typeof record.externalSourceCount === 'number'
        ? record.externalSourceCount
        : externalSources.length,
    pricingSource:
      record.pricingSource === 'serp_api' || record.pricingSource === 'serp_api_partial'
        ? record.pricingSource
        : null,
    fallbackLineItems: Array.isArray(record.fallbackLineItems)
      ? (record.fallbackLineItems as PricingDecisionAuditMetadata['fallbackLineItems'])
      : [],
    outputSource:
      record.outputSource === 'LIVE' ||
      record.outputSource === 'MOCK' ||
      record.outputSource === 'HEURISTIC' ||
      record.outputSource === 'NONE'
        ? record.outputSource
        : null,
    isFallback: record.isFallback === true,
  };
}

function dedupeExternalSources(
  sources: PricingAuditSourceReference[] | undefined
): PricingAuditSourceReference[] {
  if (!sources || sources.length === 0) return [];

  const unique = new Map<string, PricingAuditSourceReference>();
  for (const source of sources) {
    const key = [
      source.sourceType,
      source.sourceId ?? '',
      source.sourceUrl ?? '',
    ].join('|');
    if (!unique.has(key)) {
      unique.set(key, source);
    }
  }

  return Array.from(unique.values());
}

export async function logPricingDecisionAuditNonBlocking(
  input: PricingDecisionAuditInput
): Promise<void> {
  const externalSources = dedupeExternalSources(input.externalSources);

  await logAuditEventNonBlocking({
    category: 'MANUAL_CHANGE',
    action: 'PRICING_DECISION_GENERATED',
    outcome: 'SUCCESS',
    actorUserId: input.actorUserId ?? null,
    projectId: input.projectId,
    quoteId: input.quoteId,
    resourceType: 'Quote',
    resourceId: input.quoteId,
    description: 'Quote pricing decision generated with pricing and source provenance metadata.',
    metadata: {
      pricing: {
        subtotal: input.subtotal,
        total: input.total,
        calloutFeeAmount: input.calloutFeeAmount ?? 0,
      },
      eligibilityAssessmentId: input.eligibilityAssessmentId ?? null,
      discoveryVersion: input.discoveryVersion ?? null,
      aiOutput: input.aiOutput ?? null,
      externalSources,
      externalSourceCount: externalSources.length,
      pricingSource: input.pricingSource,
      fallbackLineItems: input.fallbackLineItems ?? [],
      outputSource: input.pricingSource === 'serp_api' ? 'LIVE' : ('MOCK' as AiOutputSource),
      isFallback: (input.fallbackLineItems?.length ?? 0) > 0,
    },
  });
}
