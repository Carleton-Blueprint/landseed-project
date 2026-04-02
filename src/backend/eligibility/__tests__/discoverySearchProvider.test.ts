/// <reference types="jest" />

import { describe, expect, it } from '@jest/globals';
import { resolveGrantDiscoveryMetadata } from '../discoverySearchProvider';

describe('resolveGrantDiscoveryMetadata', () => {
  it('fills versioned metadata defaults', () => {
    const metadata = resolveGrantDiscoveryMetadata();

    expect(metadata.provider).toBe('HEURISTIC');
    expect(metadata.engineVersion).toBeTruthy();
    expect(metadata.promptVersion).toBeTruthy();
    expect(metadata.scoringVersion).toBeTruthy();
    expect(metadata.modelVersion).toBeTruthy();
    expect(metadata.sourceSnapshotId).toBeNull();
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
