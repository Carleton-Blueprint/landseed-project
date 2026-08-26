/**
 * @jest-environment node
 *
 * Verifies that evaluateProjectEligibility queues Grant Match Summary PDF
 * generation for every assessment outcome (unlike the ELIGIBLE-only grant
 * application PDF trigger covered by grantPdfTrigger.test.ts) — the summary
 * must be generated even when there are no matched grants, so it can render
 * a "no matching grants found" message rather than never exist at all.
 */

export {};

jest.mock('lib/prisma', () => ({
  prisma: {
    quote: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock('../assembler', () => ({
  assembleEligibilityInput: jest.fn(),
}));

jest.mock('../repository', () => ({
  createEligibilityAssessmentSnapshot: jest.fn(),
}));

jest.mock('../discoverySearchProvider', () => ({
  discoverAndEvaluateGrants: jest.fn(),
}));

jest.mock('@/backend/audit/log', () => ({
  logAuditEventNonBlocking: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../manualReviewProducer', () => ({
  produceManualReviewFlagJob: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/backend/services/quote', () => ({
  generateQuote: jest.fn().mockResolvedValue({ quoteId: 'quote-1', estimateMin: 1000, estimateMax: 2000 }),
}));

jest.mock('@/backend/services/grantDocument', () => ({
  generateAndStoreGrantDocument: jest.fn().mockResolvedValue({
    projectId: 'proj-1',
    grantDocumentKey: 'projects/proj-1/grant/grant-application-v1.pdf',
    previousGrantDocumentKey: null,
  }),
}));

jest.mock('@/backend/queue', () => ({
  grantMatchSummaryQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { assembleEligibilityInput } = require('../assembler');
const { createEligibilityAssessmentSnapshot } = require('../repository');
const { discoverAndEvaluateGrants } = require('../discoverySearchProvider');
const { grantMatchSummaryQueue } = require('@/backend/queue');
const { evaluateProjectEligibility } = require('../service');

const baseProject = {
  id: 'proj-1',
  userId: 'user-1',
  address: '123 Main St',
  draftData: {},
  photos: [],
} as never;

function baseEvaluation(overallDecision: 'ELIGIBLE' | 'INELIGIBLE') {
  return {
    overallDecision,
    programDecisions: {},
    reasonCodes: [],
    staffReasonMessages: [],
    clientReasonMessages: [],
    missingRequirements: [],
    discoveredGrants: [],
    discoveryMetadata: {
      provider: 'test',
      engineVersion: '1',
      promptVersion: '1',
      scoringVersion: '1',
      modelVersion: '1',
      sourceSnapshotId: 'snap-1',
      candidateCount: 0,
      returnedCount: 0,
    },
  };
}

async function flushBackgroundJobs() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('evaluateProjectEligibility grant match summary trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (assembleEligibilityInput as jest.Mock).mockReturnValue({});
    (createEligibilityAssessmentSnapshot as jest.Mock).mockResolvedValue({
      id: 'assessment-1',
      createdAt: new Date(),
    });
  });

  it('queues grant match summary generation when overallDecision is ELIGIBLE', async () => {
    (discoverAndEvaluateGrants as jest.Mock).mockResolvedValue(baseEvaluation('ELIGIBLE'));

    await evaluateProjectEligibility(baseProject);
    await flushBackgroundJobs();

    expect(grantMatchSummaryQueue.add).toHaveBeenCalledWith(
      'grant-match-summary:proj-1:assessment-1',
      expect.objectContaining({ projectId: 'proj-1', actorUserId: 'user-1' })
    );
  });

  it('also queues grant match summary generation when overallDecision is INELIGIBLE (no matches case)', async () => {
    (discoverAndEvaluateGrants as jest.Mock).mockResolvedValue(baseEvaluation('INELIGIBLE'));

    await evaluateProjectEligibility(baseProject);
    await flushBackgroundJobs();

    expect(grantMatchSummaryQueue.add).toHaveBeenCalledWith(
      'grant-match-summary:proj-1:assessment-1',
      expect.objectContaining({ projectId: 'proj-1', actorUserId: 'user-1' })
    );
  });

  it('uses the performing user as actorUserId when provided', async () => {
    (discoverAndEvaluateGrants as jest.Mock).mockResolvedValue(baseEvaluation('ELIGIBLE'));

    await evaluateProjectEligibility(baseProject, { id: 'staff-1' } as never);
    await flushBackgroundJobs();

    expect(grantMatchSummaryQueue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ actorUserId: 'staff-1' })
    );
  });
});
