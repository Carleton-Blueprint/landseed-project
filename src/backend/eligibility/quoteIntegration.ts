/**
 * FR-3.1 Quote Integration
 * 
 * When generating quotes, links the latest eligibility assessment.
 * Requirements:
 * - Quote must include eligibility assessment ID (if one exists)
 * - Assessment does NOT block quote generation
 * - Assessment status captured for audit trail
 */

import { Prisma, Quote } from '@prisma/client';
import { getLatestEligibilityAssessment } from './service';
import { prisma } from 'lib/prisma';

export interface GenerateQuoteWithEligibilityInput {
  projectId: string;
  pricingMatrixVersionId: string;
  grantRulesVersionId: string;
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
        grantRulesVersionId: input.grantRulesVersionId,
        subtotal: input.subtotal,
        total: input.total,
      },
    });

    // Create audit event linking quote to eligibility assessment
    if (eligibility) {
      try {
        await prisma.auditEvent.create({
          data: {
            category: 'MANUAL_CHANGE',
            action: 'QUOTE_GENERATED_WITH_ELIGIBILITY',
            outcome: 'SUCCESS',
            projectId: input.projectId,
            quoteId: quote.id,
            resourceType: 'Quote',
            resourceId: quote.id,
            description: `Quote created; eligibility decision: ${eligibility.overallDecision}`,
            metadata: {
              eligibilityAssessmentId: eligibility.assessmentId,
              eligibilityDecision: eligibility.overallDecision,
              discoveryProvider: eligibility.discoveryProvider,
              discoveryMetadata: eligibility.discoveryMetadata,
              discoveredGrants: eligibility.discoveredGrants,
              discoveryVersion: {
                engineVersion: eligibility.discoveryEngineVersion,
                promptVersion: eligibility.discoveryPromptVersion,
                scoringVersion: eligibility.discoveryScoringVersion,
                modelVersion: eligibility.discoveryModelVersion,
                sourceSnapshotId: eligibility.discoverySourceSnapshotId,
              },
            } as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (auditError) {
        console.warn('Failed to create audit event for quote+eligibility linkage:', auditError);
      }
    }

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
