/**
 * Quote generation service with audit trail for pricing decisions and eligibility context.
 * Implements FR-2.7 auditing and FR-3.1 discovery-aware quote linking.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { getLatestEligibilityAssessment } from '@/backend/eligibility/service';
import {
  logPricingDecisionAuditNonBlocking,
  normalizePricingDecisionAuditMetadata,
  type PricingAuditSourceReference,
} from '@/backend/audit/pricing';
import {
  generateMockRefinedEstimate,
  type RefinedEstimate,
} from '@/backend/services/refinedEstimate';
import {
  DEFAULT_PRICING_TIER,
  isTieredEstimate,
  type AnyRefinedEstimate,
} from '@/backend/services/pricingTiers';
import type { ModificationCode } from '@/backend/eligibility/types';

const prisma = new PrismaClient();

interface QuoteCalculationInput {
  projectId: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  modificationCodes?: ModificationCode[];
}

interface QuoteResult {
  quoteId: string;
  subtotal: number;
  total: number;
  eligibilityAssessmentId?: string;
  estimateMin: number;
  estimateMax: number;
  pricingSource: "serp_api" | "serp_api_partial";
  refinedEstimate: AnyRefinedEstimate;
}

function getPrimaryEstimate(refinedEstimate: AnyRefinedEstimate): RefinedEstimate {
  return isTieredEstimate(refinedEstimate)
    ? refinedEstimate.tiers[refinedEstimate.selectedTier ?? DEFAULT_PRICING_TIER]
    : refinedEstimate;
}

interface PricingDecisionAuditTrailEntry {
  auditEventId: string;
  action: string;
  outcome: string;
  createdAt: Date;
  actor?: { id: string; name: string | null; email: string | null } | null;
  metadata: ReturnType<typeof normalizePricingDecisionAuditMetadata>;
}

function getPricingSourceFromRefinedEstimate(refinedEstimate: RefinedEstimate): "serp_api" | "serp_api_partial" {
  const allSerpSourced = refinedEstimate.lineItems.every((item) => item.pricingSource !== null);
  return allSerpSourced ? "serp_api" : "serp_api_partial";
}

/**
 * Generate a quote for a project with a pricing-decision audit trail and optional eligibility linkage.
 */
export async function generateQuote(
  input: QuoteCalculationInput
): Promise<QuoteResult> {
  const projectWithUser = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!projectWithUser) {
    throw new Error('Project not found');
  }

  const latestEligibility = await getLatestEligibilityAssessment(input.projectId);

  const refinedEstimate = await generateMockRefinedEstimate(input.items, input.modificationCodes ?? []);
  const primaryEstimate = getPrimaryEstimate(refinedEstimate);

  const quote = await prisma.quote.create({
    data: {
      projectId: input.projectId,
      subtotal: new Prisma.Decimal(primaryEstimate.subtotal),
      total: new Prisma.Decimal(primaryEstimate.total),
      estimateMin: new Prisma.Decimal(primaryEstimate.estimateMin),
      estimateMax: new Prisma.Decimal(primaryEstimate.estimateMax),
      refinedEstimate: refinedEstimate as unknown as Prisma.InputJsonValue,
      lastClientActivityAt: new Date(),
      eligibilityAssessmentId: latestEligibility?.assessmentId,
    },
  });

  const externalSources: PricingAuditSourceReference[] = (latestEligibility?.discoveredGrants ?? []).map((grant) => ({
    sourceType: 'DISCOVERY_GRANT_SOURCE' as const,
    sourceId: grant.grantId,
    title: grant.title,
    jurisdiction: grant.jurisdiction,
    scope: grant.scope,
    sourceUrl: grant.sourceUrl ?? null,
  }));

  await logPricingDecisionAuditNonBlocking({
    projectId: input.projectId,
    quoteId: quote.id,
    actorUserId: projectWithUser.user.id,
    subtotal: primaryEstimate.subtotal,
    total: primaryEstimate.total,
    eligibilityAssessmentId: latestEligibility?.assessmentId,
    discoveryVersion: {
      engineVersion: latestEligibility?.discoveryEngineVersion,
      promptVersion: latestEligibility?.discoveryPromptVersion,
      scoringVersion: latestEligibility?.discoveryScoringVersion,
      modelVersion: latestEligibility?.discoveryModelVersion,
      sourceSnapshotId: latestEligibility?.discoverySourceSnapshotId,
    },
    aiOutput: {
      provider: latestEligibility?.discoveryProvider ?? 'UNKNOWN',
      overallDecision: latestEligibility?.overallDecision,
      rationaleSummary: (latestEligibility?.reasonCodes ?? []).join(', '),
      resultCount: (latestEligibility?.discoveredGrants ?? []).length,
      consideredPrograms: (latestEligibility?.discoveredGrants ?? []).map((grant) => ({
        grantId: grant.grantId,
        decision: grant.decision,
        relevanceScore: grant.relevanceScore,
        rationale: grant.rationale,
        sourceUrl: grant.sourceUrl,
      })),
      rawDiscoveryMetadata: latestEligibility?.discoveryMetadata ?? null,
    },
    externalSources,
  });

  return {
    quoteId: quote.id,
    subtotal: Number(quote.subtotal.toString()),
    total: Number(quote.total.toString()),
    eligibilityAssessmentId: latestEligibility?.assessmentId,
    estimateMin: Number(quote.estimateMin!.toString()),
    estimateMax: Number(quote.estimateMax!.toString()),
    pricingSource: getPricingSourceFromRefinedEstimate(primaryEstimate),
    refinedEstimate,
  };
}

export async function getPricingDecisionAuditTrail(options: {
  quoteId?: string;
  projectId?: string;
  limit?: number;
} = {}): Promise<PricingDecisionAuditTrailEntry[]> {
  const { quoteId, projectId, limit = 50 } = options;

  const events = await prisma.auditEvent.findMany({
    where: {
      action: 'PRICING_DECISION_GENERATED',
      ...(quoteId ? { quoteId } : {}),
      ...(projectId ? { projectId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      actorUser: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return events.map((event) => ({
    auditEventId: event.id,
    action: event.action,
    outcome: event.outcome,
    createdAt: event.createdAt,
    actor: event.actorUser
      ? {
          id: event.actorUser.id,
          name: event.actorUser.name,
          email: event.actorUser.email,
        }
      : null,
    metadata: normalizePricingDecisionAuditMetadata(event.metadata),
  }));
}
