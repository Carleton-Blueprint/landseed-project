/**
 * @jest-environment node
 *
 * Verifies FR-3.2 wiring: evaluateProjectEligibility triggers grant PDF
 * generation when the overall decision is ELIGIBLE, and does not when it
 * is not ELIGIBLE. Uses the node test environment because the code under
 * test relies on the Node `setImmediate` global, which jsdom (this repo's
 * default test environment) does not provide.
 */

jest.mock('lib/prisma', () => ({
  prisma: {},
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

  it('does not generate the grant PDF when overallDecision is INELIGIBLE', async () => {
    (discoverAndEvaluateGrants as jest.Mock).mockResolvedValue(baseEvaluation('INELIGIBLE'));

    const result = await evaluateProjectEligibility(baseProject);
    expect('code' in (result as object)).toBe(false);

    await flushBackgroundJobs();

    expect(generateAndStoreGrantDocument).not.toHaveBeenCalled();
  });
});
