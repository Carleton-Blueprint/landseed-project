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
