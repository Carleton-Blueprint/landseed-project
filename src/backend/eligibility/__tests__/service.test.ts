/**
 * @jest-environment node
 *
 * Eligibility service integration tests (simplified)
 * Note: Service layer mocks are validated via integration; full unit testing
 * depends on Prisma client availability. These tests verify module structure.
 *
 * Uses the node test environment (rather than this repo's jsdom default)
 * because evaluateProjectEligibility schedules background work via the Node
 * `setImmediate` global, which jsdom does not provide. See
 * grantPdfTrigger.test.ts for the same precedent.
 */

jest.mock('lib/prisma', () => ({
  prisma: {
    quote: { findFirst: jest.fn() },
    eligibilityAssessment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
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

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('lib/prisma') as {
  prisma: {
    quote: { findFirst: jest.Mock };
    eligibilityAssessment: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
};
const { assembleEligibilityInput } = require('../assembler') as {
  assembleEligibilityInput: jest.Mock;
};
const { createEligibilityAssessmentSnapshot } = require('../repository') as {
  createEligibilityAssessmentSnapshot: jest.Mock;
};
const { discoverAndEvaluateGrants } = require('../discoverySearchProvider') as {
  discoverAndEvaluateGrants: jest.Mock;
};
const { logAuditEventNonBlocking } = require('@/backend/audit/log') as {
  logAuditEventNonBlocking: jest.Mock;
};

const {
  evaluateProjectEligibility,
  getLatestEligibilityAssessment,
  getEligibilityAssessmentHistory,
  hasEligibilityAssessment,
} = require('../service') as typeof import('../service');

const baseProject = {
  id: 'proj-1',
  userId: 'user-1',
  address: '123 Main St',
  draftData: {},
} as never;

function baseEvaluation(overrides?: Record<string, unknown>) {
  return {
    overallDecision: 'ELIGIBLE',
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
    ...overrides,
  };
}

// Background work runs inside fire-and-forget setImmediate/then chains, so
// give the event loop several ticks to drain it.
async function flushBackgroundJobs() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('Eligibility Service', () => {
  describe('Module structure', () => {
    it('should export service functions', async () => {
      const serviceModule = await import('../service');

      expect(serviceModule).toHaveProperty('evaluateProjectEligibility');
      expect(serviceModule).toHaveProperty('getLatestEligibilityAssessment');
      expect(serviceModule).toHaveProperty('getEligibilityAssessmentHistory');
      expect(serviceModule).toHaveProperty('hasEligibilityAssessment');
    });

    it('should have proper type definitions', async () => {
      const serviceModule = await import('../service');

      // Verify functions are callable
      expect(typeof serviceModule.evaluateProjectEligibility).toBe('function');
      expect(typeof serviceModule.getLatestEligibilityAssessment).toBe('function');
      expect(typeof serviceModule.getEligibilityAssessmentHistory).toBe('function');
      expect(typeof serviceModule.hasEligibilityAssessment).toBe('function');
    });
  });

  describe('evaluateProjectEligibility', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      assembleEligibilityInput.mockReturnValue({});
      prisma.quote.findFirst.mockResolvedValue(null);
    });

    it('returns PERSISTENCE_FAILED when the snapshot could not be created', async () => {
      discoverAndEvaluateGrants.mockResolvedValue(baseEvaluation());
      createEligibilityAssessmentSnapshot.mockResolvedValue(null);

      const result = await evaluateProjectEligibility(baseProject);

      expect(result).toEqual({
        code: 'PERSISTENCE_FAILED',
        message: 'Failed to persist eligibility assessment',
      });
    });

    it('returns UNKNOWN and logs the error when an unexpected error is thrown', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      assembleEligibilityInput.mockImplementation(() => {
        throw new Error('assembler exploded');
      });

      const result = await evaluateProjectEligibility(baseProject);

      expect(result).toEqual({
        code: 'UNKNOWN',
        message: 'assembler exploded',
        details: expect.any(Error),
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('logs a GRANT_DISCOVERY_AI_FALLBACK audit event when discovery fell back to the heuristic provider', async () => {
      discoverAndEvaluateGrants.mockResolvedValue(
        baseEvaluation({
          discoveryMetadata: {
            provider: 'HEURISTIC',
            aiFailureReason: 'OpenAI timeout',
            engineVersion: '1',
            promptVersion: '1',
            scoringVersion: '1',
            modelVersion: '1',
            sourceSnapshotId: 'snap-1',
            candidateCount: 0,
            returnedCount: 0,
          },
        })
      );
      createEligibilityAssessmentSnapshot.mockResolvedValue({
        id: 'assessment-1',
        createdAt: new Date(),
      });

      await evaluateProjectEligibility(baseProject);

      expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'GRANT_DISCOVERY_AI_FALLBACK',
          outcome: 'FAILURE',
          reason: 'OpenAI timeout',
        })
      );
    });

    it('logs an ELIGIBILITY_EVALUATED audit event when performedBy is provided', async () => {
      discoverAndEvaluateGrants.mockResolvedValue(baseEvaluation());
      createEligibilityAssessmentSnapshot.mockResolvedValue({
        id: 'assessment-1',
        createdAt: new Date(),
      });
      const performedBy = { id: 'user-1' } as never;

      await evaluateProjectEligibility(baseProject, performedBy);

      expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ELIGIBILITY_EVALUATED',
          outcome: 'SUCCESS',
          actorUserId: 'user-1',
        })
      );
    });

    it('does not log ELIGIBILITY_EVALUATED when performedBy is omitted', async () => {
      discoverAndEvaluateGrants.mockResolvedValue(baseEvaluation());
      createEligibilityAssessmentSnapshot.mockResolvedValue({
        id: 'assessment-1',
        createdAt: new Date(),
      });

      await evaluateProjectEligibility(baseProject);

      expect(logAuditEventNonBlocking).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ELIGIBILITY_EVALUATED' })
      );
    });

    it('skips auto-quote generation in the background when a quote already exists', async () => {
      discoverAndEvaluateGrants.mockResolvedValue(baseEvaluation());
      createEligibilityAssessmentSnapshot.mockResolvedValue({
        id: 'assessment-1',
        createdAt: new Date(),
      });
      prisma.quote.findFirst.mockResolvedValue({ id: 'existing-quote' });
      const { generateQuote } = require('@/backend/services/quote') as { generateQuote: jest.Mock };

      await evaluateProjectEligibility(baseProject);
      await flushBackgroundJobs();

      expect(generateQuote).not.toHaveBeenCalled();
    });
  });

  describe('getLatestEligibilityAssessment', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('maps the latest assessment row, filling in defaults for missing discovery fields', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      const updatedAt = new Date('2026-01-02T00:00:00Z');
      prisma.eligibilityAssessment.findFirst.mockResolvedValue({
        id: 'assessment-1',
        projectId: 'proj-1',
        overallDecision: 'ELIGIBLE',
        programDecisions: { CMHC: 'ELIGIBLE' },
        reasonCodes: ['CODE'],
        missingRequirements: [],
        createdAt,
        updatedAt,
      });

      const result = await getLatestEligibilityAssessment('proj-1');

      expect(prisma.eligibilityAssessment.findFirst).toHaveBeenCalledWith({
        where: { projectId: 'proj-1', isLatest: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({
        assessmentId: 'assessment-1',
        projectId: 'proj-1',
        overallDecision: 'ELIGIBLE',
        programDecisions: { CMHC: 'ELIGIBLE' },
        reasonCodes: ['CODE'],
        missingRequirements: [],
        discoveredGrants: [],
        discoveryMetadata: null,
        discoveryProvider: 'HEURISTIC',
        discoveryEngineVersion: 'unknown',
        discoveryPromptVersion: 'unknown',
        discoveryScoringVersion: 'unknown',
        discoveryModelVersion: 'unknown',
        discoverySourceSnapshotId: null,
        createdAt,
        updatedAt,
      });
    });

    it('returns null when there is no latest assessment', async () => {
      prisma.eligibilityAssessment.findFirst.mockResolvedValue(null);

      const result = await getLatestEligibilityAssessment('proj-2');

      expect(result).toBeNull();
    });

    it('returns null and does not throw when the query rejects', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      prisma.eligibilityAssessment.findFirst.mockRejectedValue(new Error('db down'));

      const result = await getLatestEligibilityAssessment('proj-3');

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('getEligibilityAssessmentHistory', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('uses the default limit of 10 and maps rows', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      prisma.eligibilityAssessment.findMany.mockResolvedValue([
        { id: 'a-1', overallDecision: 'ELIGIBLE', createdAt, isLatest: true },
      ]);

      const result = await getEligibilityAssessmentHistory('proj-1');

      expect(prisma.eligibilityAssessment.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      expect(result).toEqual([
        {
          assessmentId: 'a-1',
          overallDecision: 'ELIGIBLE',
          discoveryProvider: 'HEURISTIC',
          createdAt,
          isLatest: true,
        },
      ]);
    });

    it('respects a custom limit', async () => {
      prisma.eligibilityAssessment.findMany.mockResolvedValue([]);

      await getEligibilityAssessmentHistory('proj-1', 3);

      expect(prisma.eligibilityAssessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 })
      );
    });

    it('returns an empty array and does not throw when the query rejects', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      prisma.eligibilityAssessment.findMany.mockRejectedValue(new Error('db down'));

      const result = await getEligibilityAssessmentHistory('proj-1');

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('hasEligibilityAssessment', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns true when at least one assessment exists', async () => {
      prisma.eligibilityAssessment.count.mockResolvedValue(1);

      const result = await hasEligibilityAssessment('proj-1');

      expect(result).toBe(true);
    });

    it('returns false when no assessment exists', async () => {
      prisma.eligibilityAssessment.count.mockResolvedValue(0);

      const result = await hasEligibilityAssessment('proj-1');

      expect(result).toBe(false);
    });

    it('returns false and does not throw when the query rejects', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      prisma.eligibilityAssessment.count.mockRejectedValue(new Error('db down'));

      const result = await hasEligibilityAssessment('proj-1');

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
