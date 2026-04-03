/**
 * FR-3.1 Quote Integration
 * 
 * When generating quotes, links the latest eligibility assessment.
 * Requirements:
 * - Quote must include eligibility assessment ID (if one exists)
 * - Assessment does NOT block quote generation
 * - Assessment status captured for audit trail
 */

import { Quote } from '@prisma/client';
import { getLatestEligibilityAssessment } from './service';
import { prisma } from 'lib/prisma';
import {
  logPricingDecisionAuditNonBlocking,
  type PricingAuditSourceReference,
} from '@/backend/audit/pricing';

export interface GenerateQuoteWithEligibilityInput {
  projectId: string;
  pricingMatrixVersionId: string;
  subtotal: number;
  total: number;
}

export interface QuoteWithEligibility {
  quote: Quote;
  eligibilityAssessmentId?: string;
  eligibilityDecision?: string;
  discoveryProvider?: 'OPENAI' | 'HEURISTIC';
  discoveryMetadata?: unknown;
  discoveredGrants?: unknown;
}

/**
 * Generate quote with optional eligibility context
 * This function creates the quote but does NOT require an eligibility assessment.
 * However, if one exists, it's captured in the metadata.
 */
export async function generateQuoteWithEligibility(
  input: GenerateQuoteWithEligibilityInput
): Promise<QuoteWithEligibility | null> {
  try {
    // Get the latest eligibility assessment if it exists
    const eligibility = await getLatestEligibilityAssessment(input.projectId);

    // Create quote (eligibility is optional, not required)
    const quote = await prisma.quote.create({
      data: {
        projectId: input.projectId,
        pricingMatrixVersionId: input.pricingMatrixVersionId,
        eligibilityAssessmentId: eligibility?.assessmentId,
        subtotal: input.subtotal,
        total: input.total,
      },
      include: {
        pricingMatrixVersion: true,
      },
    });

    const externalSources: PricingAuditSourceReference[] = [
      ...(eligibility?.discoveredGrants ?? []).map((grant) => ({
        sourceType: 'DISCOVERY_GRANT_SOURCE' as const,
        sourceId: grant.grantId,
        title: grant.title,
        jurisdiction: grant.jurisdiction,
        scope: grant.scope,
        sourceUrl: grant.sourceUrl ?? null,
      })),
      {
        sourceType: 'PRICING_MATRIX' as const,
        sourceId: input.pricingMatrixVersionId,
        title: `Pricing Matrix v${quote.pricingMatrixVersion.versionNumber}`,
        sourceUrl: null,
      },
    ];

    await logPricingDecisionAuditNonBlocking({
      projectId: input.projectId,
      quoteId: quote.id,
      pricingMatrixVersionId: input.pricingMatrixVersionId,
      pricingMatrixVersionNumber: quote.pricingMatrixVersion.versionNumber,
      subtotal: input.subtotal,
      total: input.total,
      eligibilityAssessmentId: eligibility?.assessmentId,
      discoveryVersion: {
        engineVersion: eligibility?.discoveryEngineVersion,
        promptVersion: eligibility?.discoveryPromptVersion,
        scoringVersion: eligibility?.discoveryScoringVersion,
        modelVersion: eligibility?.discoveryModelVersion,
        sourceSnapshotId: eligibility?.discoverySourceSnapshotId,
      },
      aiOutput: {
        provider: eligibility?.discoveryProvider ?? 'UNKNOWN',
        overallDecision: eligibility?.overallDecision,
        rationaleSummary: (eligibility?.reasonCodes ?? []).join(', '),
        resultCount: (eligibility?.discoveredGrants ?? []).length,
        consideredPrograms: (eligibility?.discoveredGrants ?? []).map((grant) => ({
          grantId: grant.grantId,
          decision: grant.decision,
          relevanceScore: grant.relevanceScore,
          rationale: grant.rationale,
          sourceUrl: grant.sourceUrl,
        })),
        rawDiscoveryMetadata: eligibility?.discoveryMetadata ?? null,
      },
      externalSources,
    });

    return {
      quote,
      eligibilityAssessmentId: eligibility?.assessmentId,
      eligibilityDecision: eligibility?.overallDecision,
      discoveryProvider: eligibility?.discoveryProvider,
      discoveryMetadata: eligibility?.discoveryMetadata,
      discoveredGrants: eligibility?.discoveredGrants,
    };
  } catch (error) {
    console.error('Failed to generate quote with eligibility:', error);
    return null;
  }
}

/**
 * Get quote with its associated eligibility assessment
 */
export async function getQuoteWithEligibility(quoteId: string) {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        project: {
          select: { id: true },
        },
      },
    });

    if (!quote) {
      return null;
    }

    const eligibility = await getLatestEligibilityAssessment(quote.projectId);

    return {
      quote,
      eligibilityAssessmentId: eligibility?.assessmentId,
      eligibilityDecision: eligibility?.overallDecision,
      discoveryProvider: eligibility?.discoveryProvider,
      discoveryMetadata: eligibility?.discoveryMetadata,
      discoveredGrants: eligibility?.discoveredGrants,
      eligibilityDetails: eligibility,
    };
  } catch (error) {
    console.error('Failed to retrieve quote with eligibility:', error);
    return null;
  }
}

/**
 * Get all quotes for a project with their eligibility context
 */
export async function getProjectQuotesWithEligibility(projectId: string) {
  try {
    const quotes = await prisma.quote.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    const eligibility = await getLatestEligibilityAssessment(projectId);

    return quotes.map((quote) => ({
      quote,
      eligibilityAssessmentId: eligibility?.assessmentId,
      eligibilityDecision: eligibility?.overallDecision,
      discoveryProvider: eligibility?.discoveryProvider,
      discoveryMetadata: eligibility?.discoveryMetadata,
      discoveredGrants: eligibility?.discoveredGrants,
    }));
  } catch (error) {
    console.error('Failed to retrieve quotes with eligibility:', error);
    return [];
  }
}
