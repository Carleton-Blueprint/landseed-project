/**
 * API endpoint: POST /api/quote/generate
 * Generate a quote for a project based on provided or default line items.
 * Typically called after eligibility assessment completes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { generateQuote } from '@/backend/services/quote';
import { markEstimateReadyForReview } from '@/backend/services/estimateReadyTransition';
import { ESTIMATE_READY_TRIGGER_SOURCE } from '@/backend/notifications/estimateReadyContract';
import { getRequestAuditContext, logAuditEventNonBlocking } from '@/backend/audit/log';

export async function POST(req: NextRequest) {
  const requestContext = getRequestAuditContext(req);
  let projectIdForAudit: string | undefined;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, items } = body;
    projectIdForAudit = projectId;

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    // Use provided items or default mock items for testing
    const quoteItems = items || [
      {
        description: 'Home modifications (quote pending)',
        quantity: 1,
        unitPrice: 5000,
      },
    ];

    const result = await generateQuote({
      projectId,
      items: quoteItems,
    });

    const readyTransition = await markEstimateReadyForReview({
      projectId,
      quoteId: result.quoteId,
      triggerSource: ESTIMATE_READY_TRIGGER_SOURCE.ADVISORY_TEAM_MARK_READY_FOR_REVIEW,
    });

    await logAuditEventNonBlocking({
      category: 'MANUAL_CHANGE',
      action: 'QUOTE_GENERATED',
      outcome: 'SUCCESS',
      sensitivityLevel: 'CONFIDENTIAL',
      actorUserId: session.user.id,
      projectId,
      quoteId: result.quoteId,
      resourceType: 'quote',
      resourceId: result.quoteId,
      description: 'Quote generated via API',
      metadata: {
        itemCount: quoteItems.length,
        subtotal: result.subtotal,
        total: result.total,
        readyTransition,
      },
      ...requestContext,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Quote generation error:', error);

    await logAuditEventNonBlocking({
      category: 'MANUAL_CHANGE',
      action: 'QUOTE_GENERATED',
      outcome: 'FAILURE',
      sensitivityLevel: 'CONFIDENTIAL',
      projectId: projectIdForAudit,
      resourceType: 'quote',
      description: 'Quote generation failed',
      metadata: {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
      ...requestContext,
    });

    return NextResponse.json(
      { error: 'Failed to generate quote' },
      { status: 500 }
    );
  }
}
