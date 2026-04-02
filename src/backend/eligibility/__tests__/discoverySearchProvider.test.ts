/// <reference types="jest" />

import { describe, expect, it } from '@jest/globals';
import { discoverAndEvaluateGrants, resolveGrantDiscoveryMetadata } from '../discoverySearchProvider';
import { EligibilityDecision } from '../types';

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
  it('loads a source catalog and ranks matching grants', async () => {
    const originalEnv = {
      sourceCatalog: process.env.GRANT_DISCOVERY_SOURCE_CATALOG_JSON,
    };

    process.env.GRANT_DISCOVERY_SOURCE_CATALOG_JSON = JSON.stringify({
      grants: [
        {
          id: 'municipal-home-accessibility',
          title: 'Municipal Home Accessibility Improvement Program',
          scope: 'MUNICIPAL',
          jurisdiction: 'ON',
          sourceUrl: 'https://feeds.example.test/municipal',
          summary: 'Municipal matching grant for low-barrier home accessibility upgrades.',
          content: 'Supports grab bars and handrails for accessible home modifications.',
          keywords: ['accessibility', 'home'],
          eligibleModificationCodes: ['GRAB_BARS', 'HANDRAILS'],
          requiresConsentConfirmed: true,
        },
        {
          id: 'provincial-assistive-home',
          title: 'Provincial Assistive Home Modification Grant',
          scope: 'PROVINCIAL',
          jurisdiction: 'ON',
          sourceUrl: 'https://feeds.example.test/provincial',
          summary: 'Provincial grant for accessibility modifications.',
          content: 'Supports raised toilets and walk-in showers for qualifying households.',
          keywords: ['seniors', 'accessibility'],
          eligibleModificationCodes: ['GRAB_BARS', 'RAISED_TOILET', 'WALK_IN_SHOWER'],
          requiresConsentConfirmed: true,
        },
      ],
    });

    try {
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

      expect(result.discoveryMetadata.provider).toBe('HEURISTIC');
      expect(result.discoveryMetadata.candidateCount).toBe(2);
      expect(result.discoveryMetadata.returnedCount).toBe(2);
      expect(result.discoveryMetadata.sourceSnapshotId).toMatch(/^[a-f0-9]{12}$/);
      expect(result.discoveredGrants.map((grant) => grant.grantId)).toEqual(
        expect.arrayContaining(['municipal-home-accessibility', 'provincial-assistive-home'])
      );
      expect(result.discoveredGrants.some((grant) => grant.decision === EligibilityDecision.ELIGIBLE)).toBe(true);
      expect(result.reasonCodes).toContain('GRANTS_DISCOVERED');
      expect(result.reasonCodes).toContain('AT_LEAST_ONE_GRANT_ELIGIBLE');
    } finally {
      if (typeof originalEnv.sourceCatalog === 'undefined') {
        delete process.env.GRANT_DISCOVERY_SOURCE_CATALOG_JSON;
      } else {
        process.env.GRANT_DISCOVERY_SOURCE_CATALOG_JSON = originalEnv.sourceCatalog;
      }
    }
  });
});
