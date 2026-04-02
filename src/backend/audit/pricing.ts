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

export async function logPricingDecisionAuditNonBlocking(
  input: PricingDecisionAuditInput
): Promise<void> {
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
      externalSources: input.externalSources ?? [],
    },
  });
}
