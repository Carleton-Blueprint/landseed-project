import { logAuditEventNonBlocking } from '@/backend/audit/log';

export interface PricingAuditSourceReference {
  sourceType: 'DISCOVERY_GRANT_SOURCE' | 'PRICING_MATRIX';
  sourceId?: string;
  title?: string;
  jurisdiction?: string;
  scope?: string;
  sourceUrl?: string | null;
}

export interface PricingAuditAiOutput {
  provider: 'OPENAI' | 'HEURISTIC' | 'UNKNOWN';
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
  pricingMatrixVersionId: string;
  pricingMatrixVersionNumber?: number;
  subtotal: number;
  total: number;
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
}

export interface PricingDecisionAuditMetadata {
  pricing: {
    matrixVersionId: string;
    matrixVersionNumber?: number;
    subtotal: number;
    total: number;
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
      matrixVersionId:
        typeof pricing.matrixVersionId === 'string' ? pricing.matrixVersionId : 'unknown',
      matrixVersionNumber:
        typeof pricing.matrixVersionNumber === 'number'
          ? pricing.matrixVersionNumber
          : undefined,
      subtotal: typeof pricing.subtotal === 'number' ? pricing.subtotal : 0,
      total: typeof pricing.total === 'number' ? pricing.total : 0,
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
        matrixVersionId: input.pricingMatrixVersionId,
        matrixVersionNumber: input.pricingMatrixVersionNumber,
        subtotal: input.subtotal,
        total: input.total,
      },
      eligibilityAssessmentId: input.eligibilityAssessmentId ?? null,
      discoveryVersion: input.discoveryVersion ?? null,
      aiOutput: input.aiOutput ?? null,
      externalSources,
      externalSourceCount: externalSources.length,
    },
  });
}
