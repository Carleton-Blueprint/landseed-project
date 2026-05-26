/**
 * Quote generation service with audit trail for pricing matrix and eligibility context.
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

const prisma = new PrismaClient();

interface QuoteCalculationInput {
  projectId: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
}

interface QuoteResult {
  quoteId: string;
  subtotal: number;
  total: number;
  pricingMatrixVersion: number;
  eligibilityAssessmentId?: string;
  estimateMin: number;
  estimateMax: number;
  refinedEstimate: RefinedEstimate;
}

interface PricingDecisionAuditTrailEntry {
  auditEventId: string;
  action: string;
  outcome: string;
  createdAt: Date;
  actor?: { id: string; name: string | null; email: string | null } | null;
  metadata: ReturnType<typeof normalizePricingDecisionAuditMetadata>;
}

async function getActivePricingMatrixVersion() {
  const activeVersion = await prisma.pricingMatrixVersion.findFirst({
    where: { isActive: true },
    orderBy: { versionNumber: 'desc' },
  });

  if (!activeVersion) {
    throw new Error('No active pricing matrix version found');
  }

  return activeVersion;
}

/**
 * Generate a quote for a project with pricing matrix audit and optional eligibility linkage.
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

  const pricingMatrixVersion = await getActivePricingMatrixVersion();
  const latestEligibility = await getLatestEligibilityAssessment(input.projectId);

  const refinedEstimate = await generateMockRefinedEstimate(input.items);

  const quote = await prisma.quote.create({
    data: {
      projectId: input.projectId,
      subtotal: new Prisma.Decimal(refinedEstimate.subtotal),
      total: new Prisma.Decimal(refinedEstimate.total),
      estimateMin: new Prisma.Decimal(refinedEstimate.estimateMin),
      estimateMax: new Prisma.Decimal(refinedEstimate.estimateMax),
      refinedEstimate: refinedEstimate as unknown as Prisma.InputJsonValue,
      lastClientActivityAt: new Date(),
      pricingMatrixVersionId: pricingMatrixVersion.id,
      eligibilityAssessmentId: latestEligibility?.assessmentId,
    },
    include: {
      pricingMatrixVersion: true,
    },
  });

  const externalSources: PricingAuditSourceReference[] = [
    ...(latestEligibility?.discoveredGrants ?? []).map((grant) => ({
      sourceType: 'DISCOVERY_GRANT_SOURCE' as const,
      sourceId: grant.grantId,
      title: grant.title,
      jurisdiction: grant.jurisdiction,
      scope: grant.scope,
      sourceUrl: grant.sourceUrl ?? null,
    })),
    {
      sourceType: 'PRICING_MATRIX' as const,
      sourceId: pricingMatrixVersion.id,
      title: `Pricing Matrix v${pricingMatrixVersion.versionNumber}`,
      sourceUrl: null,
    },
  ];

  await logPricingDecisionAuditNonBlocking({
    projectId: input.projectId,
    quoteId: quote.id,
    actorUserId: projectWithUser.user.id,
    pricingMatrixVersionId: pricingMatrixVersion.id,
    pricingMatrixVersionNumber: pricingMatrixVersion.versionNumber,
    subtotal: refinedEstimate.subtotal,
    total: refinedEstimate.total,
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
    pricingMatrixVersion: quote.pricingMatrixVersion.versionNumber,
    eligibilityAssessmentId: latestEligibility?.assessmentId,
    estimateMin: Number((quote as { estimateMin?: { toString(): string } }).estimateMin?.toString()) || refinedEstimate.estimateMin,
    estimateMax: Number((quote as { estimateMax?: { toString(): string } }).estimateMax?.toString()) || refinedEstimate.estimateMax,
    refinedEstimate,
  };
}

export async function createPricingMatrixVersion(
  data: Prisma.InputJsonValue,
  userId: string,
  changeSummary?: string
): Promise<string> {
  const previousVersion = await prisma.pricingMatrixVersion.findFirst({
    where: { isActive: true },
    orderBy: { versionNumber: 'desc' },
  });

  if (previousVersion) {
    await prisma.pricingMatrixVersion.update({
      where: { id: previousVersion.id },
      data: { isActive: false },
    });
  }

  const maxVersion = await prisma.pricingMatrixVersion.findFirst({
    orderBy: { versionNumber: 'desc' },
  });
  const nextVersionNumber = (maxVersion?.versionNumber ?? 0) + 1;

  const newVersion = await prisma.pricingMatrixVersion.create({
    data: {
      versionNumber: nextVersionNumber,
      data,
      createdByUserId: userId,
      isActive: true,
    },
  });

  await prisma.pricingMatrixAuditLog.create({
    data: {
      versionId: newVersion.id,
      changedByUserId: userId,
      changeSummary: changeSummary || 'New pricing matrix version created',
      beforeState: previousVersion?.data ?? Prisma.JsonNull,
      afterState: data,
    },
  });

  return newVersion.id;
}

export async function getQuoteAuditHistory(quoteId: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      pricingMatrixVersion: {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      project: {
        select: { id: true, address: true },
      },
      eligibilityAssessment: {
        select: {
          id: true,
          overallDecision: true,
          discoveryProvider: true,
          createdAt: true,
        },
      },
    },
  });

  if (!quote) {
    throw new Error('Quote not found');
  }

  const pricingDecisionAudit = await getPricingDecisionAuditTrail({ quoteId, limit: 20 });

  return {
    quote: {
      id: quote.id,
      subtotal: quote.subtotal.toString(),
      total: quote.total.toString(),
      generatedAt: quote.generatedAt,
    },
    project: quote.project,
    versionsUsed: {
      pricingMatrix: {
        versionNumber: quote.pricingMatrixVersion.versionNumber,
        createdAt: quote.pricingMatrixVersion.createdAt,
        createdBy: quote.pricingMatrixVersion.createdBy,
      },
      eligibilityAssessment: quote.eligibilityAssessment,
    },
    pricingDecisionAudit,
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

export async function getPricingMatrixAuditTrail(limit = 50) {
  return prisma.pricingMatrixAuditLog.findMany({
    take: limit,
    orderBy: { changedAt: 'desc' },
    include: {
      version: {
        select: { versionNumber: true },
      },
      changedBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}
