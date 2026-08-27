/**
 * @jest-environment node
 *
 * Verifies FR-3.2 wiring: evaluateProjectEligibility triggers grant PDF
 * generation once the overall decision is final (ELIGIBLE or INELIGIBLE -
 * see isFinalEligibilityDecision), regardless of whether a quote already
 * existed for the project (the normal intake order) or had to be created
 * here (the pre-estimate/FR-4.10 order) - see service.ts Step 6. Uses the
 * node test environment because the code under test relies on the Node
 * `setImmediate` global, which jsdom (this repo's default test
 * environment) does not provide.
 */

const findFirstMock = jest.fn().mockResolvedValue(null);

jest.mock('lib/prisma', () => ({
  prisma: {
    quote: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
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

// evaluateProjectEligibility() also enqueues Grant Match Summary generation
// on the real "grant-match-summary" Redis queue for every assessment. Left
// unmocked, this hits the real dev Redis instance and enqueues a job for
// 'proj-1', which any running grant-match-summary worker would later fail
// to process ("Project not found") since it isn't a real project. See
// grantMatchSummaryTrigger.test.ts for the dedicated coverage of this queue
// call's behavior.
jest.mock('@/backend/queue', () => ({
  grantMatchSummaryQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { assembleEligibilityInput } = require('../assembler');
const { createEligibilityAssessmentSnapshot } = require('../repository');
const { discoverAndEvaluateGrants } = require('../discoverySearchProvider');
const { generateAndStoreGrantDocument } = require('@/backend/services/grantDocument');
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

// The PDF/quote generation runs inside fire-and-forget setImmediate/then
// chains, so give the event loop several ticks to drain them.
async function flushBackgroundJobs() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('evaluateProjectEligibility grant PDF trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findFirstMock.mockResolvedValue(null);
    (assembleEligibilityInput as jest.Mock).mockReturnValue({});
    (createEligibilityAssessmentSnapshot as jest.Mock).mockResolvedValue({
      id: 'assessment-1',
      createdAt: new Date(),
    });
    (generateAndStoreGrantDocument as jest.Mock).mockResolvedValue({
      projectId: 'proj-1',
      grantDocumentKey: 'projects/proj-1/grant/grant-application-v1.pdf',
      previousGrantDocumentKey: null,
    });
  });

  it('generates the grant PDF when overallDecision is ELIGIBLE', async () => {
    (discoverAndEvaluateGrants as jest.Mock).mockResolvedValue(baseEvaluation('ELIGIBLE'));

    const result = await evaluateProjectEligibility(baseProject);
    expect('code' in (result as object)).toBe(false);

    await flushBackgroundJobs();

    expect(generateAndStoreGrantDocument).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' })
    );
  });

  it('builds the auto-quote from the project\'s real declared modification codes, not a flat placeholder', async () => {
    (discoverAndEvaluateGrants as jest.Mock).mockResolvedValue(baseEvaluation('ELIGIBLE'));
    const { generateQuote } = require('@/backend/services/quote');

    const projectWithPhotos = {
      id: 'proj-1',
      userId: 'user-1',
      address: '123 Main St',
      draftData: {},
      photos: [{ declaredModificationCodes: ['GRAB_BARS'] }],
    } as never;

    await evaluateProjectEligibility(projectWithPhotos);
    await flushBackgroundJobs();

    expect(generateQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        modificationCodes: ['GRAB_BARS'],
        items: [
          expect.objectContaining({
            description: 'Grab Bars',
            modificationCode: 'GRAB_BARS',
            unitPrice: 180,
          }),
        ],
      })
    );
  });

  it('generates the grant PDF when overallDecision is INELIGIBLE (a final decision, per isFinalEligibilityDecision)', async () => {
    (discoverAndEvaluateGrants as jest.Mock).mockResolvedValue(baseEvaluation('INELIGIBLE'));

    const result = await evaluateProjectEligibility(baseProject);
    expect('code' in (result as object)).toBe(false);

    await flushBackgroundJobs();

    expect(generateAndStoreGrantDocument).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' })
    );
  });

  it('generates the grant PDF when a quote already exists (the normal intake order)', async () => {
    // Regression test: previously the existingQuote early-return exited the whole
    // setImmediate callback, skipping grant PDF generation entirely whenever a
    // quote already existed - the default order for every normal intake.
    findFirstMock.mockResolvedValue({ id: 'existing-quote-1' });
    (discoverAndEvaluateGrants as jest.Mock).mockResolvedValue(baseEvaluation('ELIGIBLE'));
    const { generateQuote } = require('@/backend/services/quote');

    const result = await evaluateProjectEligibility(baseProject);
    expect('code' in (result as object)).toBe(false);

    await flushBackgroundJobs();

    expect(generateQuote).not.toHaveBeenCalled();
    expect(generateAndStoreGrantDocument).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' })
    );
  });

  it('generates the grant PDF after the auto-created quote commits, in the pre-estimate order', async () => {
    // The grant application PDF depends on the latest quote for its estimatedCost
    // field (assembleGrantPdfInput), so when eligibility runs before a quote
    // exists, quote creation must resolve before PDF generation is invoked.
    findFirstMock.mockResolvedValue(null);
    (discoverAndEvaluateGrants as jest.Mock).mockResolvedValue(baseEvaluation('ELIGIBLE'));
    const { generateQuote } = require('@/backend/services/quote');

    const callOrder: string[] = [];
    (generateQuote as jest.Mock).mockImplementation(async () => {
      callOrder.push('generateQuote');
      return { quoteId: 'quote-1', estimateMin: 1000, estimateMax: 2000 };
    });
    (generateAndStoreGrantDocument as jest.Mock).mockImplementation(async () => {
      callOrder.push('generateAndStoreGrantDocument');
      return {
        projectId: 'proj-1',
        grantDocumentKey: 'projects/proj-1/grant/grant-application-v1.pdf',
        previousGrantDocumentKey: null,
      };
    });

    await evaluateProjectEligibility(baseProject);
    await flushBackgroundJobs();

    expect(callOrder).toEqual(['generateQuote', 'generateAndStoreGrantDocument']);
  });
});
