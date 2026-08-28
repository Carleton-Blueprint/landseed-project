/// <reference types="jest" />

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  discoverAndEvaluateGrants,
  resolveGrantDiscoveryMetadata,
  detectCatalogContradictions,
  scoreCandidate,
  dedupeAiCandidates,
  DiscoveredGrant,
  GrantDiscoveryScope,
} from '../discoverySearchProvider';
import { GrantDiscoverySourceEntry } from '../discoverySourceCatalog';
import { EligibilityDecision, EligibilityInput } from '../types';

const originalFetch = globalThis.fetch;

const baseEligibilityInput: EligibilityInput = {
  project: {
    projectId: 'project-test',
    projectStatus: 'draft',
    address: '123 Main St',
  },
  required: {
    province: 'ON',
    ownershipStatus: 'owner',
    clientConsentConfirmed: true,
    modificationCodes: ['GRAB_BARS', 'HANDRAILS'],
  },
  optional: {
    name: null,
    email: null,
    phone: null,
    city: 'Toronto',
    postalCode: null,
    ownershipOtherDetails: null,
    landlordName: null,
    landlordPhone: null,
    isCaregiver: false,
    seniorName: null,
    relationshipToSenior: null,
    caregiverConsentConfirmed: null,
  },
  missingRequiredFields: [],
  malformedDraftFields: [],
};

function catalogFetchFallback() {
  return new Response('<html><head><title>Fallback</title></head><body></body></html>', {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function saveDiscoveryEnv() {
  return {
    openAiKey: process.env.OPENAI_API_KEY,
    aiModel: process.env.GRANT_DISCOVERY_AI_MODEL,
  };
}

function restoreDiscoveryEnv(saved: ReturnType<typeof saveDiscoveryEnv>) {
  const entries: Array<[string, string | undefined]> = [
    ['OPENAI_API_KEY', saved.openAiKey],
    ['GRANT_DISCOVERY_AI_MODEL', saved.aiModel],
  ];

  for (const [key, value] of entries) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function configureLiveAiEnv() {
  process.env.OPENAI_API_KEY = 'test-key';
}

function mockOpenAiDecision(overrides: Partial<{
  grantId: string;
  title: string;
  scope: string;
  jurisdiction: string;
  sourceUrl: string;
  summary: string;
  score: number;
  decision: EligibilityDecision;
  matchedCriteria: string[];
  missingCriteria: string[];
  confidence: string;
  rationale: string;
  estimatedFundingAmount: string | null;
}> = {}) {
  return {
    grantId: 'live_hatc_canada',
    title: 'Home Accessibility Tax Credit (HATC)',
    scope: 'NATIONAL',
    jurisdiction: 'CA',
    sourceUrl: 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31285-home-accessibility-expenses.html',
    summary: 'Federal tax credit for eligible accessibility renovations.',
    score: 88,
    decision: EligibilityDecision.ELIGIBLE,
    matchedCriteria: ['jurisdiction_match', 'modification_overlap'],
    missingCriteria: [],
    confidence: 'HIGH',
    rationale: 'Applicant profile matches federal HATC criteria.',
    ...overrides,
  };
}

afterEach(() => {
  const globalWithOptionalFetch = globalThis as typeof globalThis & {
    fetch?: typeof fetch;
  };

  if (typeof originalFetch === 'undefined') {
    Reflect.deleteProperty(globalWithOptionalFetch, 'fetch');
  } else {
    globalThis.fetch = originalFetch;
  }
  jest.restoreAllMocks();
});

describe('resolveGrantDiscoveryMetadata', () => {
  it('fills versioned metadata defaults', () => {
    const metadata = resolveGrantDiscoveryMetadata();

    expect(metadata.provider).toBe('HEURISTIC');
    expect(metadata.engineVersion).toMatch(/^[a-f0-9]{12}$/);
    expect(metadata.promptVersion).toMatch(/^[a-f0-9]{12}$/);
    expect(metadata.scoringVersion).toMatch(/^[a-f0-9]{12}$/);
    expect(metadata.modelVersion).toMatch(/^[a-f0-9]{12}$/);
    expect(metadata.sourceSnapshotId).toMatch(/^[a-f0-9]{12}$/);
    expect(metadata.query).toBe('');
    expect(metadata.searchedScopes).toEqual(['MUNICIPAL', 'PROVINCIAL', 'NATIONAL']);
    expect(metadata.candidateCount).toBe(0);
    expect(metadata.returnedCount).toBe(0);
    expect(metadata.executedAt).toBeTruthy();
  });

  it('allows metadata overrides for future discovery runs', () => {
    const metadata = resolveGrantDiscoveryMetadata({
      provider: 'OPENAI',
      engineVersion: '2026.04.02',
      promptVersion: '2026.04.02',
      scoringVersion: '2026.04.02',
      modelVersion: 'gpt-5.4-mini',
      sourceSnapshotId: 'snapshot-123',
      query: 'home accessibility grants',
      searchedScopes: ['MUNICIPAL', 'NATIONAL'],
      candidateCount: 14,
      returnedCount: 5,
      executedAt: '2026-04-02T14:15:00.000Z',
    });

    expect(metadata.provider).toBe('OPENAI');
    expect(metadata.engineVersion).toBe('2026.04.02');
    expect(metadata.promptVersion).toBe('2026.04.02');
    expect(metadata.scoringVersion).toBe('2026.04.02');
    expect(metadata.modelVersion).toBe('gpt-5.4-mini');
    expect(metadata.sourceSnapshotId).toBe('snapshot-123');
    expect(metadata.query).toBe('home accessibility grants');
    expect(metadata.searchedScopes).toEqual(['MUNICIPAL', 'NATIONAL']);
    expect(metadata.candidateCount).toBe(14);
    expect(metadata.returnedCount).toBe(5);
    expect(metadata.executedAt).toBe('2026-04-02T14:15:00.000Z');
  });
});

describe('discoverAndEvaluateGrants', () => {
  it('fetches the built-in source URLs and ranks matching grants', async () => {
    const originalOpenAiKey = process.env.OPENAI_API_KEY;

    delete process.env.OPENAI_API_KEY;

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const htmlByUrl: Record<string, string> = {
          'https://www.ontario.ca/page/accessibility': `
            <html>
              <head>
                <title>Municipal Home Accessibility Improvement Program</title>
                <meta name="description" content="Municipal matching grant for low-barrier home accessibility upgrades.">
              </head>
              <body>Supports grab bars and handrails for accessible home modifications.</body>
            </html>
          `,
          'https://www.ontario.ca/page/home-and-community-care': `
            <html>
              <head>
                <title>Provincial Assistive Home Modification Grant</title>
                <meta name="description" content="Provincial grant for accessibility modifications.">
              </head>
              <body>Supports raised toilets and walk-in showers for qualifying households.</body>
            </html>
          `,
          'https://www.canada.ca/en/services/benefits/disability.html': `
            <html>
              <head>
                <title>National Disability and Home Accessibility Benefit</title>
                <meta name="description" content="Federal support for medically necessary residential accessibility improvements.">
              </head>
              <body>Supports accessibility improvements for eligible Canadians requiring residential modifications.</body>
            </html>
          `,
        };

        return new Response(htmlByUrl[url] ?? '<html><head><title>Fallback</title></head><body></body></html>', {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
        });
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants({
        project: {
          projectId: 'project-1',
          projectStatus: 'draft',
          address: '123 Main St',
        },
        required: {
          province: 'ON',
          ownershipStatus: 'owner',
          clientConsentConfirmed: true,
          modificationCodes: ['GRAB_BARS', 'HANDRAILS'],
        },
        optional: {
          name: null,
          email: null,
          phone: null,
          city: null,
          postalCode: null,
          ownershipOtherDetails: null,
          landlordName: null,
          landlordPhone: null,
          isCaregiver: false,
          seniorName: null,
          relationshipToSenior: null,
          caregiverConsentConfirmed: null,
        },
        missingRequiredFields: [],
        malformedDraftFields: [],
      });

      expect(fetchMock).toHaveBeenCalledTimes(result.discoveryMetadata.candidateCount);
      expect(result.discoveryMetadata.provider).toBe('HEURISTIC');
      expect(result.discoveryMetadata.candidateCount).toBeGreaterThanOrEqual(3);
      expect(result.discoveryMetadata.returnedCount).toBeGreaterThanOrEqual(3);
      expect(result.discoveryMetadata.sourceSnapshotId).toMatch(/^[a-f0-9]{12}$/);
      expect(result.discoveredGrants.map((grant) => grant.grantId)).toEqual(
        expect.arrayContaining(['hatc_canada', 'on_rrap', 'toronto_hip'])
      );
      expect(result.reasonCodes).toContain('GRANTS_DISCOVERED');
      expect(
        result.reasonCodes.some((reasonCode) =>
          ['AT_LEAST_ONE_GRANT_ELIGIBLE', 'NO_IMMEDIATE_GRANT_MATCHES'].includes(reasonCode)
        )
      ).toBe(true);
    } finally {
      if (typeof originalOpenAiKey === 'undefined') {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiKey;
      }
    }
  });

  it('uses fetch-mocked OpenAI decisions when live AI path succeeds', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                decisions: [mockOpenAiDecision()],
              }),
              usage: { prompt_tokens: 1200, completion_tokens: 400 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/responses',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.discoveryMetadata.provider).toBe('OPENAI');
      expect(result.discoveredGrants.map((grant) => grant.grantId)).toEqual(
        expect.arrayContaining(['live_hatc_canada'])
      );
      expect(result.programDecisions.live_hatc_canada).toBe(EligibilityDecision.ELIGIBLE);
    } finally {
      restoreDiscoveryEnv(savedEnv);
    }
  });

  it('carries the AI-supplied estimatedFundingAmount through to the discovered grant', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                decisions: [mockOpenAiDecision({ estimatedFundingAmount: 'Up to $20,000' })],
              }),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      const grant = result.discoveredGrants.find((g) => g.grantId === 'live_hatc_canada');
      expect(grant?.estimatedFundingAmount).toBe('Up to $20,000');
    } finally {
      restoreDiscoveryEnv(savedEnv);
    }
  });

  it('defaults estimatedFundingAmount to null when the AI omits it', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                decisions: [mockOpenAiDecision()],
              }),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      const grant = result.discoveredGrants.find((g) => g.grantId === 'live_hatc_canada');
      expect(grant?.estimatedFundingAmount).toBeNull();
    } finally {
      restoreDiscoveryEnv(savedEnv);
    }
  });

  it('falls back to heuristic when OpenAI returns a non-OK response', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          return new Response('{"error":"rate_limit_exceeded"}', {
            status: 429,
            headers: { 'content-type': 'application/json' },
          });
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(result.discoveryMetadata.provider).toBe('HEURISTIC');
      expect(result.discoveredGrants.length).toBeGreaterThan(0);
      expect(result.discoveredGrants.map((grant) => grant.grantId)).not.toContain('live_hatc_canada');
      expect(result.discoveryMetadata.aiFailureReason).toMatch(/429/);
    } finally {
      restoreDiscoveryEnv(savedEnv);
    }
  });

  it('falls back to heuristic when OpenAI returns malformed JSON', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          return new Response(
            JSON.stringify({
              output_text: 'not valid json {{{',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(result.discoveryMetadata.provider).toBe('HEURISTIC');
      expect(result.discoveryMetadata.aiFailureReason).toMatch(/parse/i);
    } finally {
      restoreDiscoveryEnv(savedEnv);
    }
  });

  it('falls back to heuristic when OpenAI returns empty content', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          return new Response(
            JSON.stringify({ output: [{ type: 'message', content: [] }] }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(result.discoveryMetadata.provider).toBe('HEURISTIC');
      expect(result.discoveryMetadata.aiFailureReason).toMatch(/no output text/i);
    } finally {
      restoreDiscoveryEnv(savedEnv);
    }
  });

  it('does not report a failure reason when AI is unconfigured (no API key)', async () => {
    const originalOpenAiKey = process.env.OPENAI_API_KEY;

    delete process.env.OPENAI_API_KEY;

    try {
      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = jest.fn(
        async () => catalogFetchFallback()
      ) as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(result.discoveryMetadata.provider).toBe('HEURISTIC');
      expect(result.discoveryMetadata.aiFailureReason).toBeNull();
    } finally {
      if (typeof originalOpenAiKey === 'undefined') {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiKey;
      }
    }
  });

  it('filters malformed OpenAI decisions and keeps valid ones', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                decisions: [
                  mockOpenAiDecision(),
                  { grantId: 'bad_grant', score: 'not-a-number', decision: 'ELIGIBLE' },
                ],
              }),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(result.discoveryMetadata.provider).toBe('OPENAI');
      expect(result.discoveredGrants.map((grant) => grant.grantId)).toContain('live_hatc_canada');
      expect(result.discoveredGrants.map((grant) => grant.grantId)).not.toContain('bad_grant');
    } finally {
      restoreDiscoveryEnv(savedEnv);
    }
  });

  it('includes city in municipal search query sent to OpenAI', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();

    try {
      let capturedBody = '';
      const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          capturedBody = String(init?.body ?? '');
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({ decisions: [mockOpenAiDecision()] }),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(capturedBody).toContain('Toronto');
      expect(capturedBody).toContain('municipal home accessibility grant program');
    } finally {
      restoreDiscoveryEnv(savedEnv);
    }
  });

  it('sends the OpenAI-Organization header when OPENAI_ORG_ID is configured', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();
    const originalOrgId = process.env.OPENAI_ORG_ID;
    process.env.OPENAI_ORG_ID = 'org-landseed-123';

    try {
      let capturedHeaders: HeadersInit | undefined;
      const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          capturedHeaders = init?.headers;
          return new Response(
            JSON.stringify({ output_text: JSON.stringify({ decisions: [mockOpenAiDecision()] }) }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(capturedHeaders).toMatchObject({ 'OpenAI-Organization': 'org-landseed-123' });
    } finally {
      if (typeof originalOrgId === 'undefined') {
        delete process.env.OPENAI_ORG_ID;
      } else {
        process.env.OPENAI_ORG_ID = originalOrgId;
      }
      restoreDiscoveryEnv(savedEnv);
    }
  });

  it('omits the OpenAI-Organization header when OPENAI_ORG_ID is not configured', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();
    const originalOrgId = process.env.OPENAI_ORG_ID;
    delete process.env.OPENAI_ORG_ID;

    try {
      let capturedHeaders: HeadersInit | undefined;
      const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          capturedHeaders = init?.headers;
          return new Response(
            JSON.stringify({ output_text: JSON.stringify({ decisions: [mockOpenAiDecision()] }) }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(capturedHeaders).not.toHaveProperty('OpenAI-Organization');
    } finally {
      if (typeof originalOrgId === 'undefined') {
        delete process.env.OPENAI_ORG_ID;
      } else {
        process.env.OPENAI_ORG_ID = originalOrgId;
      }
      restoreDiscoveryEnv(savedEnv);
    }
  });
});

describe('detectCatalogContradictions', () => {
  function makeGrant(overrides: Partial<DiscoveredGrant>): DiscoveredGrant {
    return {
      grantId: 'on_adp',
      title: 'Ontario Assistive Devices Program (ADP)',
      scope: 'PROVINCIAL',
      jurisdiction: 'ON',
      sourceUrl: 'https://www.ontario.ca/page/assistive-devices-program',
      summary: 'Funds assistive devices.',
      decision: EligibilityDecision.ELIGIBLE,
      relevanceScore: 80,
      confidence: 'HIGH',
      matchedCriteria: [],
      missingCriteria: [],
      rationale: 'test',
      estimatedFundingAmount: null,
      ...overrides,
    };
  }

  it('flags a grant marked ELIGIBLE whose catalog entry has an empty eligibleModificationCodes list (not modification-specific)', () => {
    const grants = [makeGrant({ grantId: 'on_adp', decision: EligibilityDecision.ELIGIBLE })];

    const contradictions = detectCatalogContradictions(grants, ['GRAB_BARS']);

    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].grantId).toBe('on_adp');
  });

  it('flags a grant marked ELIGIBLE whose catalog entry has no overlap with the requested modification codes', () => {
    // hatc_canada covers GRAB_BARS/RAISED_TOILET/WALK_IN_SHOWER/WIDENED_DOORWAY/STAIR_LIFT/HANDRAILS —
    // none of which is requested here.
    const grants = [
      makeGrant({
        grantId: 'hatc_canada',
        title: 'Home Accessibility Tax Credit (HATC)',
        decision: EligibilityDecision.ELIGIBLE,
      }),
    ];

    const contradictions = detectCatalogContradictions(grants, []);

    expect(contradictions).toHaveLength(1);
  });

  it('does not flag a grant whose catalog entry overlaps the requested modification codes', () => {
    const grants = [
      makeGrant({
        grantId: 'hatc_canada',
        title: 'Home Accessibility Tax Credit (HATC)',
        decision: EligibilityDecision.ELIGIBLE,
      }),
    ];

    const contradictions = detectCatalogContradictions(grants, ['GRAB_BARS']);

    expect(contradictions).toHaveLength(0);
  });

  it('does not flag a grant that is not ELIGIBLE, even if the catalog has no overlap', () => {
    const grants = [makeGrant({ grantId: 'on_adp', decision: EligibilityDecision.INELIGIBLE })];

    const contradictions = detectCatalogContradictions(grants, ['GRAB_BARS']);

    expect(contradictions).toHaveLength(0);
  });

  it('does not flag a grant whose grantId has no matching catalog entry (novel AI discovery)', () => {
    const grants = [
      makeGrant({
        grantId: 'some_novel_program_the_ai_found',
        decision: EligibilityDecision.ELIGIBLE,
      }),
    ];

    const contradictions = detectCatalogContradictions(grants, ['GRAB_BARS']);

    expect(contradictions).toHaveLength(0);
  });
});

describe('scoreCandidate', () => {
  // Deliberately maxes out every non-modification signal (jurisdiction, text
  // overlap, keyword overlap, owner-occupied, consent) so that, pre-fix, the
  // combined score alone clears eligibleThreshold (75) with no modification
  // overlap at all — reproducing the on_adp-style false positive.
  function makeMaxSignalSource(
    overrides: Partial<GrantDiscoverySourceEntry>
  ): GrantDiscoverySourceEntry {
    return {
      id: 'test_program',
      title: 'Test Device Program',
      scope: 'PROVINCIAL',
      jurisdiction: 'ON',
      sourceUrl: 'https://example.com/test-program',
      summary: 'A synthetic program used for testing.',
      keywords: ['alpha', 'beta', 'gamma', 'delta'],
      requiresOwnerOccupied: true,
      requiresConsentConfirmed: true,
      ...overrides,
    };
  }

  const maxSignalQueryTokens = [
    'test', 'device', 'program', 'synthetic', 'testing', 'alpha', 'beta', 'gamma', 'delta',
  ];

  it('caps a device-only program (empty eligibleModificationCodes) below ELIGIBLE even when every other signal maxes out', () => {
    const source = makeMaxSignalSource({ eligibleModificationCodes: [] });

    const result = scoreCandidate(baseEligibilityInput, source, maxSignalQueryTokens);

    expect(result.score).toBeLessThan(75);
    expect(result.decision).not.toBe(EligibilityDecision.ELIGIBLE);
    expect(result.missingCriteria).toContain('no_modification_overlap');
  });

  it('caps a modification-specific program with zero code overlap below ELIGIBLE even when every other signal maxes out', () => {
    const source = makeMaxSignalSource({ eligibleModificationCodes: ['RAISED_TOILET'] });

    const result = scoreCandidate(baseEligibilityInput, source, maxSignalQueryTokens);

    expect(result.score).toBeLessThan(75);
    expect(result.decision).not.toBe(EligibilityDecision.ELIGIBLE);
    expect(result.missingCriteria).toContain('no_modification_overlap');
  });

  it('still allows ELIGIBLE when the program overlaps the requested modification codes', () => {
    const source = makeMaxSignalSource({ eligibleModificationCodes: ['GRAB_BARS', 'HANDRAILS'] });

    const result = scoreCandidate(baseEligibilityInput, source, maxSignalQueryTokens);

    expect(result.decision).toBe(EligibilityDecision.ELIGIBLE);
    expect(result.matchedCriteria.some((c) => c.startsWith('modification_overlap_'))).toBe(true);
  });

  it('does not exclude on modification codes when the project requests none', () => {
    const source = makeMaxSignalSource({ eligibleModificationCodes: [] });
    const input: EligibilityInput = {
      ...baseEligibilityInput,
      required: { ...baseEligibilityInput.required, modificationCodes: [] },
    };

    const result = scoreCandidate(input, source, maxSignalQueryTokens);

    expect(result.decision).toBe(EligibilityDecision.ELIGIBLE);
    expect(result.missingCriteria).not.toContain('no_modification_overlap');
  });

  it('extracts an "up to $X" funding figure from the catalog summary', () => {
    const source = makeMaxSignalSource({
      eligibleModificationCodes: ['GRAB_BARS'],
      summary: 'Federal tax credit on up to $20,000 of eligible home renovation expenses.',
    });

    const result = scoreCandidate(baseEligibilityInput, source, maxSignalQueryTokens);

    expect(result.estimatedFundingAmount).toBe('up to $20,000');
  });

  it('falls back to the first bare dollar figure when no "up to" phrasing is present', () => {
    const source = makeMaxSignalSource({
      eligibleModificationCodes: ['GRAB_BARS'],
      summary: 'A forgivable loan program providing $40,000 toward accessibility renovations.',
    });

    const result = scoreCandidate(baseEligibilityInput, source, maxSignalQueryTokens);

    expect(result.estimatedFundingAmount).toBe('$40,000');
  });

  it('returns null estimatedFundingAmount when no dollar figure appears in the summary', () => {
    const source = makeMaxSignalSource({
      eligibleModificationCodes: ['GRAB_BARS'],
      summary: 'A program with no stated funding amount in its description.',
    });

    const result = scoreCandidate(baseEligibilityInput, source, maxSignalQueryTokens);

    expect(result.estimatedFundingAmount).toBeNull();
  });
});

describe('dedupeAiCandidates', () => {
  function makeCandidate(overrides: Partial<{
    grantId: string;
    title: string;
    sourceUrl: string;
    score: number;
  }> = {}) {
    const { grantId = 'grant_a', title = 'Home and Vehicle Modification Program', sourceUrl = 'https://www.ontario.ca/page/home-and-vehicle-modification-program', score = 70 } = overrides;
    return {
      source: {
        id: grantId,
        title,
        scope: 'PROVINCIAL' as GrantDiscoveryScope,
        jurisdiction: 'ON',
        sourceUrl,
        summary: 'A grant program.',
      },
      score,
      decision: EligibilityDecision.ELIGIBLE,
      matchedCriteria: [],
      missingCriteria: [],
      confidence: 'HIGH' as const,
      rationale: 'test',
      estimatedFundingAmount: null,
    };
  }

  it('collapses duplicate grantIds, keeping the higher-scoring entry', () => {
    const candidates = [makeCandidate({ score: 60 }), makeCandidate({ score: 90 })];

    const deduped = dedupeAiCandidates(candidates);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].score).toBe(90);
  });

  it('collapses entries with the same title and sourceUrl even under different grantIds', () => {
    const candidates = [
      makeCandidate({ grantId: 'on_hvmp', score: 55 }),
      makeCandidate({ grantId: 'on_hvmp_duplicate', score: 55 }),
    ];

    const deduped = dedupeAiCandidates(candidates);

    expect(deduped).toHaveLength(1);
  });

  it('keeps distinct programs separate', () => {
    const candidates = [
      makeCandidate({ grantId: 'on_hvmp' }),
      makeCandidate({
        grantId: 'hatc_canada',
        title: 'Home Accessibility Tax Credit (HATC)',
        sourceUrl: 'https://www.canada.ca/en/revenue-agency/hatc',
      }),
    ];

    const deduped = dedupeAiCandidates(candidates);

    expect(deduped).toHaveLength(2);
  });

  it('is reflected end-to-end when the AI returns a duplicate decision', async () => {
    const savedEnv = saveDiscoveryEnv();
    configureLiveAiEnv();

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('api.openai.com/v1/responses')) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                decisions: [mockOpenAiDecision(), mockOpenAiDecision()],
              }),
              usage: { prompt_tokens: 1200, completion_tokens: 400 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return catalogFetchFallback();
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      const liveHatcEntries = result.discoveredGrants.filter((grant) => grant.grantId === 'live_hatc_canada');
      expect(liveHatcEntries).toHaveLength(1);
    } finally {
      restoreDiscoveryEnv(savedEnv);
    }
  });
});
