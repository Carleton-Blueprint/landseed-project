import { EligibilityDecision, EligibilityInput } from './types';

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

const DEFAULT_ENGINE_VERSION = process.env.GRANT_DISCOVERY_ENGINE_VERSION ?? 'phase-1-contract';
const DEFAULT_PROMPT_VERSION = process.env.GRANT_DISCOVERY_PROMPT_VERSION ?? 'phase-1-contract';
const DEFAULT_SCORING_VERSION = process.env.GRANT_DISCOVERY_SCORING_VERSION ?? 'phase-1-contract';
const DEFAULT_MODEL_VERSION = process.env.GRANT_DISCOVERY_AI_MODEL ?? 'unconfigured';

export function resolveGrantDiscoveryMetadata(
  overrides: GrantDiscoveryMetadataOverrides = {}
): GrantDiscoveryMetadata {
  return {
    provider: overrides.provider ?? 'HEURISTIC',
    engineVersion: overrides.engineVersion ?? DEFAULT_ENGINE_VERSION,
    promptVersion: overrides.promptVersion ?? DEFAULT_PROMPT_VERSION,
    scoringVersion: overrides.scoringVersion ?? DEFAULT_SCORING_VERSION,
    modelVersion: overrides.modelVersion ?? DEFAULT_MODEL_VERSION,
    sourceSnapshotId: overrides.sourceSnapshotId ?? null,
    query: overrides.query ?? '',
    searchedScopes: overrides.searchedScopes ?? ['MUNICIPAL', 'PROVINCIAL', 'NATIONAL'],
    candidateCount: overrides.candidateCount ?? 0,
    returnedCount: overrides.returnedCount ?? 0,
    executedAt: overrides.executedAt ?? new Date().toISOString(),
  };
}
