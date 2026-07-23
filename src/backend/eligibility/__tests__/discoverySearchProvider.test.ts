/// <reference types="jest" />

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { discoverAndEvaluateGrants, resolveGrantDiscoveryMetadata } from '../discoverySearchProvider';
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
    aiEnabled: process.env.GRANT_DISCOVERY_AI_ENABLED,
    mockAi: process.env.GRANT_DISCOVERY_MOCK_AI,
    openAiKey: process.env.OPENAI_API_KEY,
    aiModel: process.env.GRANT_DISCOVERY_AI_MODEL,
  };
}

function restoreDiscoveryEnv(saved: ReturnType<typeof saveDiscoveryEnv>) {
  const entries: Array<[string, string | undefined]> = [
    ['GRANT_DISCOVERY_AI_ENABLED', saved.aiEnabled],
    ['GRANT_DISCOVERY_MOCK_AI', saved.mockAi],
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
  process.env.GRANT_DISCOVERY_AI_ENABLED = 'true';
  process.env.GRANT_DISCOVERY_MOCK_AI = 'false';
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
  it('uses mocked LLM decisions when mock AI mode is enabled', async () => {
    const originalAiEnabled = process.env.GRANT_DISCOVERY_AI_ENABLED;
    const originalMockAi = process.env.GRANT_DISCOVERY_MOCK_AI;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;

    process.env.GRANT_DISCOVERY_AI_ENABLED = 'true';
    process.env.GRANT_DISCOVERY_MOCK_AI = 'true';
    process.env.OPENAI_API_KEY = 'test-key';

    try {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('api.openai.com')) {
          throw new Error('Mock AI mode should not call OpenAI API');
        }

        return new Response('<html><head><title>Fallback</title></head><body></body></html>', {
          status: 404,
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
        });
      });

      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

      const result = await discoverAndEvaluateGrants({
        project: {
          projectId: 'project-mock-ai',
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

      expect(result.discoveryMetadata.provider).toBe('OPENAI');
      expect(result.discoveryMetadata.returnedCount).toBeGreaterThanOrEqual(3);
      expect(result.discoveredGrants.map((grant) => grant.grantId)).toEqual(
        expect.arrayContaining(['mock_hatc_canada', 'mock_on_rrap', 'mock_municipal_toronto'])
      );
      expect(result.programDecisions.mock_hatc_canada).toBe(EligibilityDecision.ELIGIBLE);
      expect(result.programDecisions.mock_on_rrap).toBe(EligibilityDecision.NEEDS_MORE_INFO);
      expect(result.programDecisions.mock_municipal_toronto).toBe(EligibilityDecision.INELIGIBLE);
      expect(result.overallDecision).toBe(EligibilityDecision.ELIGIBLE);
      expect(result.reasonCodes).toContain('GRANTS_DISCOVERED');
      expect(result.reasonCodes).toContain('AT_LEAST_ONE_GRANT_ELIGIBLE');
    } finally {
      if (typeof originalAiEnabled === 'undefined') {
        delete process.env.GRANT_DISCOVERY_AI_ENABLED;
      } else {
        process.env.GRANT_DISCOVERY_AI_ENABLED = originalAiEnabled;
      }

      if (typeof originalMockAi === 'undefined') {
        delete process.env.GRANT_DISCOVERY_MOCK_AI;
      } else {
        process.env.GRANT_DISCOVERY_MOCK_AI = originalMockAi;
      }

      if (typeof originalOpenAiKey === 'undefined') {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiKey;
      }
    }
  });

  it('fetches the built-in source URLs and ranks matching grants', async () => {
    const originalAiEnabled = process.env.GRANT_DISCOVERY_AI_ENABLED;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;

    process.env.GRANT_DISCOVERY_AI_ENABLED = 'false';
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
      if (typeof originalAiEnabled === 'undefined') {
        delete process.env.GRANT_DISCOVERY_AI_ENABLED;
      } else {
        process.env.GRANT_DISCOVERY_AI_ENABLED = originalAiEnabled;
      }

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

  it('does not report a failure reason when AI is intentionally disabled', async () => {
    const originalAiEnabled = process.env.GRANT_DISCOVERY_AI_ENABLED;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;

    process.env.GRANT_DISCOVERY_AI_ENABLED = 'false';
    delete process.env.OPENAI_API_KEY;

    try {
      (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = jest.fn(
        async () => catalogFetchFallback()
      ) as typeof fetch;

      const result = await discoverAndEvaluateGrants(baseEligibilityInput);

      expect(result.discoveryMetadata.provider).toBe('HEURISTIC');
      expect(result.discoveryMetadata.aiFailureReason).toBeNull();
    } finally {
      if (typeof originalAiEnabled === 'undefined') {
        delete process.env.GRANT_DISCOVERY_AI_ENABLED;
      } else {
        process.env.GRANT_DISCOVERY_AI_ENABLED = originalAiEnabled;
      }

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
