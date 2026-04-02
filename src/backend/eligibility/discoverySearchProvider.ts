import { EligibilityDecision, EligibilityInput } from './types';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

export type GrantDiscoveryScope = 'MUNICIPAL' | 'PROVINCIAL' | 'NATIONAL';

export type GrantDiscoveryProvider = 'OPENAI' | 'HEURISTIC';

export interface DiscoveredGrant {
  grantId: string;
  title: string;
  scope: GrantDiscoveryScope;
  jurisdiction: string;
  sourceUrl: string | null;
  summary: string;
  decision: EligibilityDecision;
  relevanceScore: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchedCriteria: string[];
  missingCriteria: string[];
  rationale: string;
}

export interface GrantDiscoveryMetadata {
  provider: GrantDiscoveryProvider;
  engineVersion: string;
  promptVersion: string;
  scoringVersion: string;
  modelVersion: string;
  sourceSnapshotId: string | null;
  query: string;
  searchedScopes: GrantDiscoveryScope[];
  candidateCount: number;
  returnedCount: number;
  executedAt: string;
}

export interface GrantDiscoveryEvaluationResult {
  overallDecision: EligibilityDecision;
  programDecisions: Record<string, EligibilityDecision>;
  reasonCodes: string[];
  staffReasonMessages: string[];
  clientReasonMessages: string[];
  missingRequirements: string[];
  discoveredGrants: DiscoveredGrant[];
  discoveryMetadata: GrantDiscoveryMetadata;
}

export interface GrantDiscoverySearchProvider {
  discover(input: EligibilityInput): Promise<GrantDiscoveryEvaluationResult>;
}

export interface GrantDiscoveryMetadataOverrides
  extends Partial<Omit<GrantDiscoveryMetadata, 'executedAt'>> {
  executedAt?: string;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function readVersionedFile(relativePath: string): string {
  try {
    const filePath = path.join(process.cwd(), relativePath);
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function resolveAutomaticVersions(): Omit<GrantDiscoveryMetadata, 'provider' | 'query' | 'searchedScopes' | 'candidateCount' | 'returnedCount' | 'executedAt' | 'sourceSnapshotId'> & {
  sourceSnapshotId: string;
} {
  const engineSource = readVersionedFile('src/backend/eligibility/discoverySearchProvider.ts');
  const promptSource = readVersionedFile('src/backend/eligibility/discoveryPrompt.ts');
  const scoringSource = readVersionedFile('src/backend/eligibility/discoveryScoringConfig.ts');
  const modelSource = readVersionedFile('src/backend/eligibility/discoveryModelConfig.ts');

  const engineVersion = engineSource ? hashContent(engineSource) : 'unknown';
  const promptVersion = promptSource ? hashContent(promptSource) : 'unknown';
  const scoringVersion = scoringSource ? hashContent(scoringSource) : 'unknown';
  const modelVersion = modelSource ? hashContent(modelSource) : 'unknown';
  const sourceSnapshotId = hashContent([engineVersion, promptVersion, scoringVersion, modelVersion].join('|'));

  return {
    engineVersion,
    promptVersion,
    scoringVersion,
    modelVersion,
    sourceSnapshotId,
  };
}

export function resolveGrantDiscoveryMetadata(
  overrides: GrantDiscoveryMetadataOverrides = {}
): GrantDiscoveryMetadata {
  const automaticVersions = resolveAutomaticVersions();

  return {
    provider: overrides.provider ?? 'HEURISTIC',
    engineVersion: overrides.engineVersion ?? automaticVersions.engineVersion,
    promptVersion: overrides.promptVersion ?? automaticVersions.promptVersion,
    scoringVersion: overrides.scoringVersion ?? automaticVersions.scoringVersion,
    modelVersion: overrides.modelVersion ?? automaticVersions.modelVersion,
    sourceSnapshotId: overrides.sourceSnapshotId ?? automaticVersions.sourceSnapshotId,
    query: overrides.query ?? '',
    searchedScopes: overrides.searchedScopes ?? ['MUNICIPAL', 'PROVINCIAL', 'NATIONAL'],
    candidateCount: overrides.candidateCount ?? 0,
    returnedCount: overrides.returnedCount ?? 0,
    executedAt: overrides.executedAt ?? new Date().toISOString(),
  };
}
