import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { DISCOVERY_MODEL_NAME } from './discoveryModelConfig';
import { DISCOVERY_SYSTEM_PROMPT } from './discoveryPrompt';
import { DISCOVERY_SCORING_CONFIG } from './discoveryScoringConfig';
import { DISCOVERY_FALLBACK_SOURCE_CATALOG, GrantDiscoverySourceEntry } from './discoverySourceCatalog';
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

interface LlmGrantDecision {
  grantId: string;
  title: string;
  scope: GrantDiscoveryScope;
  jurisdiction: string;
  sourceUrl: string | null;
  summary: string;
  score: number;
  decision: EligibilityDecision;
  matchedCriteria: string[];
  missingCriteria: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
}

interface DiscoveryCandidateEvaluation {
  source: GrantDiscoverySourceEntry;
  score: number;
  decision: EligibilityDecision;
  matchedCriteria: string[];
  missingCriteria: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
}

// ---------------------------------------------------------------------------
// Hashing / versioning helpers
// ---------------------------------------------------------------------------

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

function resolveAutomaticVersions(): Omit<
  GrantDiscoveryMetadata,
  'provider' | 'query' | 'searchedScopes' | 'candidateCount' | 'returnedCount' | 'executedAt' | 'sourceSnapshotId'
> & { sourceSnapshotId: string } {
  const engineSource = readVersionedFile('src/backend/eligibility/discoverySearchProvider.ts');
  const promptSource = readVersionedFile('src/backend/eligibility/discoveryPrompt.ts');
  const scoringSource = readVersionedFile('src/backend/eligibility/discoveryScoringConfig.ts');
  const modelSource = readVersionedFile('src/backend/eligibility/discoveryModelConfig.ts');

  const engineVersion = engineSource ? hashContent(engineSource) : 'unknown';
  const promptVersion = promptSource ? hashContent(promptSource) : 'unknown';
  const scoringVersion = scoringSource ? hashContent(scoringSource) : 'unknown';
  const modelVersion = modelSource ? hashContent(modelSource) : 'unknown';
  const sourceSnapshotId = hashContent([engineVersion, promptVersion, scoringVersion, modelVersion].join('|'));

  return { engineVersion, promptVersion, scoringVersion, modelVersion, sourceSnapshotId };
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return Array.from(new Set(normalized.split(/\s+/).filter(Boolean)));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v.trim().length > 0)));
}

function uniqueSourceUrls(sources: GrantDiscoverySourceEntry[]): string[] {
  return Array.from(new Set(sources.map((s) => s.sourceUrl).filter((v) => v.trim().length > 0)));
}

function extractHtmlTitle(html: string): string | null {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
}

function extractMetaDescription(html: string): string | null {
  return (
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]?.trim() ?? null
  );
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

/**
 * Builds the human-readable search queries that will be handed to the AI web
 * search tool.  We generate one query per scope so the model can search
 * municipal, provincial, and national programs independently.
 */
function buildSearchQueries(input: EligibilityInput): { scope: GrantDiscoveryScope; query: string }[] {
  const province = input.required.province ?? 'Canada';
  const mods = input.required.modificationCodes.join(', ') || 'accessibility modifications';

  return [
    {
      scope: 'NATIONAL' as GrantDiscoveryScope,
      query: `Canada national home accessibility grant program ${mods} 2024 2025`,
    },
    {
      scope: 'PROVINCIAL' as GrantDiscoveryScope,
      query: `${province} provincial home accessibility grant program ${mods} 2024 2025`,
    },
    {
      scope: 'MUNICIPAL' as GrantDiscoveryScope,
      query: `${province} municipal city home accessibility grant program ${mods} 2024 2025`,
    },
  ];
}

/** Legacy single-string query kept for metadata / heuristic path. */
function buildSearchQuery(input: EligibilityInput): string {
  const province = input.required.province ?? 'unknown-province';
  const ownership = input.required.ownershipStatus ?? 'unknown-ownership';
  const modifications = input.required.modificationCodes.join(',') || 'general-accessibility';
  return ['home accessibility grants', `province:${province}`, `ownership:${ownership}`, `modifications:${modifications}`].join(' | ');
}

// ---------------------------------------------------------------------------
// Catalog / source loading (used for heuristic fallback)
// ---------------------------------------------------------------------------

function parseCatalogPayload(raw: unknown, sourceHint?: string): GrantDiscoverySourceEntry[] {
  const rawEntries = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Array.isArray((raw as { grants?: unknown }).grants)
      ? (raw as { grants: unknown[] }).grants
      : Array.isArray((raw as { sources?: unknown }).sources)
      ? (raw as { sources: unknown[] }).sources
      : []
    : [];

  const parsed: GrantDiscoverySourceEntry[] = [];

  for (const candidate of rawEntries) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;

    const record = candidate as Record<string, unknown>;
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : null;
    const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : null;
    const scope = typeof record.scope === 'string' ? record.scope.trim().toUpperCase() : null;
    const jurisdiction =
      typeof record.jurisdiction === 'string' && record.jurisdiction.trim()
        ? record.jurisdiction.trim().toUpperCase()
        : null;
    const sourceUrl =
      typeof record.sourceUrl === 'string' && record.sourceUrl.trim()
        ? record.sourceUrl.trim()
        : sourceHint ?? null;

    if (!id || !title || !scope || !jurisdiction || !sourceUrl) continue;

    parsed.push({
      id,
      title,
      scope: scope as GrantDiscoveryScope,
      jurisdiction,
      sourceUrl,
      summary:
        typeof record.summary === 'string' && record.summary.trim()
          ? record.summary.trim()
          : 'Grant discovered from a source-backed catalog.',
      content: typeof record.content === 'string' ? record.content : undefined,
      keywords: Array.isArray(record.keywords)
        ? record.keywords.filter((k): k is string => typeof k === 'string')
        : undefined,
      eligibleModificationCodes: Array.isArray(record.eligibleModificationCodes)
        ? record.eligibleModificationCodes.filter((k): k is string => typeof k === 'string')
        : undefined,
      requiresOwnerOccupied:
        typeof record.requiresOwnerOccupied === 'boolean' ? record.requiresOwnerOccupied : undefined,
      requiresConsentConfirmed:
        typeof record.requiresConsentConfirmed === 'boolean' ? record.requiresConsentConfirmed : undefined,
    });
  }

  return parsed;
}

async function fetchCatalogFromUrl(source: GrantDiscoverySourceEntry): Promise<GrantDiscoverySourceEntry[]> {
  try {
    const response = await fetch(source.sourceUrl, {
      headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
    });
    if (!response.ok) return [];

    const bodyText = await response.text();
    const trimmed = bodyText.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = parseCatalogPayload(JSON.parse(trimmed), source.sourceUrl);
        if (parsed.length > 0) return parsed;
      } catch {
        // fall through
      }
    }

    return [
      {
        ...source,
        title: extractHtmlTitle(trimmed) ?? source.title,
        summary: extractMetaDescription(trimmed) ?? source.summary,
        content: trimmed,
      },
    ];
  } catch {
    return [];
  }
}

async function loadDiscoverySources(): Promise<GrantDiscoverySourceEntry[]> {
  const liveSources = DISCOVERY_FALLBACK_SOURCE_CATALOG.filter(
    (source) => uniqueSourceUrls([source]).length > 0
  );
  const fetched = (await Promise.all(liveSources.map(fetchCatalogFromUrl))).flat();
  return fetched.length > 0 ? fetched : DISCOVERY_FALLBACK_SOURCE_CATALOG;
}

function calculateSourceSnapshotId(sources: GrantDiscoverySourceEntry[]): string {
  const normalized = sources
    .map((s) => ({
      id: s.id,
      title: s.title,
      scope: s.scope,
      jurisdiction: s.jurisdiction,
      sourceUrl: s.sourceUrl,
      summary: s.summary,
      content: s.content ?? '',
      keywords: uniqueStrings(s.keywords ?? []).sort(),
      eligibleModificationCodes: uniqueStrings(s.eligibleModificationCodes ?? []).sort(),
      requiresOwnerOccupied: s.requiresOwnerOccupied ?? false,
      requiresConsentConfirmed: s.requiresConsentConfirmed ?? true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return hashContent(JSON.stringify(normalized));
}

// ---------------------------------------------------------------------------
// Heuristic scorer (used when AI is disabled / unavailable)
// ---------------------------------------------------------------------------

function scoreCandidate(
  input: EligibilityInput,
  source: GrantDiscoverySourceEntry,
  queryTokens: string[]
): DiscoveryCandidateEvaluation {
  const matchedCriteria: string[] = [];
  const missingCriteria: string[] = [];
  let score = 0;

  const province = input.required.province?.toUpperCase() ?? null;
  const candidateText = tokenize(
    [source.title, source.summary, source.content ?? '', ...(source.keywords ?? [])].join(' ')
  );
  const textOverlap = queryTokens.filter((t) => candidateText.includes(t));

  if (source.scope === 'NATIONAL') {
    score += DISCOVERY_SCORING_CONFIG.nationalScopePoints;
    matchedCriteria.push('national_program_available');
  } else if (province && source.jurisdiction === province) {
    score += DISCOVERY_SCORING_CONFIG.jurisdictionMatchPoints;
    matchedCriteria.push('jurisdiction_match');
  } else if (!province) {
    missingCriteria.push('province_required_for_jurisdiction_match');
  } else {
    score += DISCOVERY_SCORING_CONFIG.jurisdictionMismatchPoints;
    missingCriteria.push('jurisdiction_mismatch');
  }

  if (textOverlap.length > 0) {
    const overlapScore = Math.min(
      textOverlap.length * DISCOVERY_SCORING_CONFIG.textOverlapPointsPerToken,
      DISCOVERY_SCORING_CONFIG.textOverlapMaxPoints
    );
    score += overlapScore;
    matchedCriteria.push(`text_overlap_${textOverlap.length}`);
  } else {
    missingCriteria.push('no_text_overlap');
  }

  const keywordOverlapCount = uniqueStrings(source.keywords ?? []).filter((kw) =>
    queryTokens.includes(normalizeText(kw))
  ).length;

  if (keywordOverlapCount > 0) {
    const keywordScore = Math.min(
      keywordOverlapCount * DISCOVERY_SCORING_CONFIG.keywordMatchPointsPerToken,
      DISCOVERY_SCORING_CONFIG.keywordMatchMaxPoints
    );
    score += keywordScore;
    matchedCriteria.push(`keyword_overlap_${keywordOverlapCount}`);
  }

  if (source.requiresOwnerOccupied) {
    if (input.required.ownershipStatus === 'owner') {
      score += DISCOVERY_SCORING_CONFIG.ownerOccupiedMatchPoints;
      matchedCriteria.push('owner_occupied_requirement_met');
    } else {
      missingCriteria.push('owner_occupied_requirement_not_met');
    }
  } else {
    score += DISCOVERY_SCORING_CONFIG.ownershipCompatiblePoints;
    matchedCriteria.push('ownership_compatible');
  }

  if (source.requiresConsentConfirmed) {
    if (input.required.clientConsentConfirmed) {
      score += DISCOVERY_SCORING_CONFIG.consentMatchPoints;
      matchedCriteria.push('consent_confirmed');
    } else {
      missingCriteria.push('consent_confirmation_missing');
    }
  }

  const eligibleModificationCodes = uniqueStrings(source.eligibleModificationCodes ?? []);
  if (eligibleModificationCodes.length > 0) {
    const requestedMods = input.required.modificationCodes;
    const overlapCount = requestedMods.filter((code) => eligibleModificationCodes.includes(code)).length;

    if (requestedMods.length > 0) {
      const overlapRatio = overlapCount / requestedMods.length;
      score += Math.round(overlapRatio * DISCOVERY_SCORING_CONFIG.modificationOverlapMaxPoints);

      if (overlapRatio > 0) {
        matchedCriteria.push(`modification_overlap_${Math.round(overlapRatio * 100)}pct`);
      } else {
        missingCriteria.push('no_modification_overlap');
      }
    }
  }

  if (input.missingRequiredFields.length > 0) {
    score -= Math.min(
      input.missingRequiredFields.length * DISCOVERY_SCORING_CONFIG.missingFieldPenaltyPerField,
      DISCOVERY_SCORING_CONFIG.missingFieldPenaltyMax
    );
    missingCriteria.push('missing_required_application_fields');
  }

  const cappedScore = Math.max(0, Math.min(100, score));

  let decision = EligibilityDecision.INELIGIBLE;
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

  if (input.missingRequiredFields.length > 0) {
    decision = EligibilityDecision.NEEDS_MORE_INFO;
    confidence = 'LOW';
  } else if (cappedScore >= DISCOVERY_SCORING_CONFIG.eligibleThreshold) {
    decision = EligibilityDecision.ELIGIBLE;
    confidence = 'HIGH';
  } else if (cappedScore >= DISCOVERY_SCORING_CONFIG.needsMoreInfoThreshold) {
    decision = EligibilityDecision.NEEDS_MORE_INFO;
    confidence = 'MEDIUM';
  }

  return {
    source,
    score: cappedScore,
    decision,
    matchedCriteria,
    missingCriteria,
    confidence,
    rationale:
      decision === EligibilityDecision.ELIGIBLE
        ? 'High criteria overlap across jurisdiction, scope, text search, ownership, consent, and requested modifications.'
        : decision === EligibilityDecision.NEEDS_MORE_INFO
        ? 'Partial eligibility indicators found, but additional data or criteria alignment is required.'
        : 'Current project profile does not meet enough grant criteria to recommend eligibility.',
  };
}

// ---------------------------------------------------------------------------
// AI web-search discovery  ← THE KEY CHANGE
// ---------------------------------------------------------------------------

/**
 * Uses the OpenAI `web_search_preview` tool so the model actively searches the
 * web for real grant programs instead of re-scoring a static catalog.
 *
 * The model is asked to return a JSON object with a `decisions` array whose
 * shape matches `LlmGrantDecision`.  Each element represents one real grant
 * program it found online, complete with a live `sourceUrl`.
 */
async function tryOpenAiWebSearch(
  input: EligibilityInput,
  fallbackCandidates: DiscoveryCandidateEvaluation[]
): Promise<LlmGrantDecision[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const enabled = (process.env.GRANT_DISCOVERY_AI_ENABLED ?? 'true').toLowerCase();
  if (enabled === 'false') return null;

  const scopedQueries = buildSearchQueries(input);

  const profile = {
    province: input.required.province,
    ownershipStatus: input.required.ownershipStatus,
    consentConfirmed: input.required.clientConsentConfirmed,
    modificationCodes: input.required.modificationCodes,
    missingFields: input.missingRequiredFields,
  };

  /**
   * The system prompt (imported from discoveryPrompt.ts) should instruct the
   * model to:
   *   1. Use the web_search tool to search for grants matching the queries.
   *   2. Evaluate each found grant against the applicant profile.
   *   3. Return ONLY a JSON object: { "decisions": [ ...LlmGrantDecision ] }
   *
   * The queries are embedded in the user message so the model knows exactly
   * what to search for at each scope level.
   */
  const userMessage = JSON.stringify({
    profile,
    searchQueries: scopedQueries,
    instructions:
      'Search the web using each query in searchQueries. For every real grant program you find, ' +
      'evaluate it against the applicant profile and include it in the decisions array. ' +
      'Assign a unique grantId (snake_case), set scope to MUNICIPAL/PROVINCIAL/NATIONAL, ' +
      'set jurisdiction to the ISO province code (e.g. "ON") or "CA" for national programs, ' +
      'and include the live sourceUrl where the grant was found. ' +
      'Return ONLY valid JSON: { "decisions": [ ...grant objects ] }',
    // Provide fallback catalog IDs so the model can also re-assess known sources
    knownCandidates: fallbackCandidates.map((c) => ({
      grantId: c.source.id,
      title: c.source.title,
      scope: c.source.scope,
      jurisdiction: c.source.jurisdiction,
      sourceUrl: c.source.sourceUrl,
      baselineScore: c.score,
    })),
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DISCOVERY_MODEL_NAME, // Should be "gpt-4o" or "gpt-4o-mini" — must support tools
      temperature: 0,
      // ↓ This is the critical addition: give the model a real web search tool
      tools: [
        {
          type: 'web_search_preview',
        },
      ],
      tool_choice: 'auto',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: DISCOVERY_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  } | null;

  const content = body?.choices?.[0]?.message?.content;
  if (!content) return null;

  let parsed: { decisions?: LlmGrantDecision[] } | null = null;
  try {
    parsed = JSON.parse(content) as { decisions?: LlmGrantDecision[] };
  } catch {
    return null;
  }

  if (!Array.isArray(parsed.decisions)) return null;

  return parsed.decisions.filter(
    (item) =>
      typeof item.grantId === 'string' &&
      typeof item.score === 'number' &&
      typeof item.decision === 'string' &&
      Array.isArray(item.matchedCriteria) &&
      Array.isArray(item.missingCriteria) &&
      typeof item.rationale === 'string'
  );
}

// ---------------------------------------------------------------------------
// Result assembly
// ---------------------------------------------------------------------------

function summarizeOverallDecision(grants: DiscoveryCandidateEvaluation[]): EligibilityDecision {
  if (grants.some((g) => g.decision === EligibilityDecision.ELIGIBLE)) return EligibilityDecision.ELIGIBLE;
  if (grants.some((g) => g.decision === EligibilityDecision.NEEDS_MORE_INFO))
    return EligibilityDecision.NEEDS_MORE_INFO;
  if (grants.length === 0) return EligibilityDecision.MANUAL_REVIEW;
  return EligibilityDecision.INELIGIBLE;
}

function buildMessages(
  overallDecision: EligibilityDecision,
  discovered: DiscoveryCandidateEvaluation[]
): { staff: string[]; client: string[]; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const staff: string[] = [];

  if (discovered.length === 0) {
    reasonCodes.push('NO_DISCOVERED_GRANTS');
    staff.push('No grants were discovered for this intake profile across configured sources.');
  } else {
    reasonCodes.push('GRANTS_DISCOVERED');
    reasonCodes.push(
      discovered.some((g) => g.decision === EligibilityDecision.ELIGIBLE)
        ? 'AT_LEAST_ONE_GRANT_ELIGIBLE'
        : 'NO_IMMEDIATE_GRANT_MATCHES'
    );
    staff.push(`Discovered ${discovered.length} grant programs across municipal/provincial/national scopes.`);
  }

  const client =
    overallDecision === EligibilityDecision.ELIGIBLE
      ? ['We found grant programs that match your project profile.']
      : overallDecision === EligibilityDecision.NEEDS_MORE_INFO
      ? ['We found possible grants, but we need more information to confirm eligibility.']
      : overallDecision === EligibilityDecision.MANUAL_REVIEW
      ? ['Your grant eligibility requires manual review by staff.']
      : ['We could not find a strong grant eligibility match based on current details.'];

  return { staff, client, reasonCodes };
}

function buildDiscoveryResult(
  input: EligibilityInput,
  evaluations: DiscoveryCandidateEvaluation[],
  metadataOverrides: Partial<GrantDiscoveryMetadata>
): GrantDiscoveryEvaluationResult {
  const discoveredGrants = evaluations.map((item) => ({
    grantId: item.source.id,
    title: item.source.title,
    scope: item.source.scope,
    jurisdiction: item.source.jurisdiction,
    sourceUrl: item.source.sourceUrl,
    summary: item.source.summary,
    decision: item.decision,
    relevanceScore: item.score,
    confidence: item.confidence,
    matchedCriteria: item.matchedCriteria,
    missingCriteria: item.missingCriteria,
    rationale: item.rationale,
  }));

  const overallDecision = summarizeOverallDecision(evaluations);
  const messageSet = buildMessages(overallDecision, evaluations);

  if (input.missingRequiredFields.length > 0) {
    messageSet.reasonCodes.push('MISSING_REQUIRED_FIELDS');
  }

  const metadata = resolveGrantDiscoveryMetadata({
    ...metadataOverrides,
    searchedScopes: ['MUNICIPAL', 'PROVINCIAL', 'NATIONAL'],
  });

  const programDecisions = Object.fromEntries(
    discoveredGrants.map((g) => [g.grantId, g.decision])
  );

  return {
    overallDecision,
    programDecisions,
    reasonCodes: messageSet.reasonCodes,
    staffReasonMessages: [
      ...messageSet.staff,
      ...discoveredGrants.map((g) => `${g.title}: ${g.decision} (${g.relevanceScore}/100)`),
    ],
    clientReasonMessages: messageSet.client,
    missingRequirements: input.missingRequiredFields.map(String),
    discoveredGrants,
    discoveryMetadata: metadata,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function discoverAndEvaluateGrants(
  input: EligibilityInput
): Promise<GrantDiscoveryEvaluationResult> {
  // Step 1: Load static/catalog sources for heuristic baseline
  const sources = await loadDiscoverySources();
  const query = buildSearchQuery(input);
  const queryTokens = tokenize(query);

  // Step 2: Heuristic scoring of catalog sources (always runs, used as fallback)
  const heuristicCandidates = sources
    .map((source) => scoreCandidate(input, source, queryTokens))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const sourceSnapshotId = calculateSourceSnapshotId(sources);

  let provider: GrantDiscoveryProvider = 'HEURISTIC';
  let finalCandidates = heuristicCandidates;

  try {
    // Step 3: AI web search — finds REAL grants from the live web
    const llmDecisions = await tryOpenAiWebSearch(input, heuristicCandidates);

    if (llmDecisions && llmDecisions.length > 0) {
      provider = 'OPENAI';

      // Convert AI-discovered grants into DiscoveryCandidateEvaluation shape
      // so the rest of the pipeline stays unchanged.
      const aiCandidates: DiscoveryCandidateEvaluation[] = llmDecisions.map((llm) => ({
        source: {
          // Synthesize a GrantDiscoverySourceEntry from the AI response
          id: llm.grantId,
          title: llm.title ?? llm.grantId,
          scope: (llm.scope as GrantDiscoveryScope) ?? 'NATIONAL',
          jurisdiction: llm.jurisdiction ?? 'CA',
          sourceUrl: llm.sourceUrl ?? '',
          summary: llm.summary ?? llm.rationale,
        },
        score: Math.max(0, Math.min(100, Math.round(llm.score))),
        decision: llm.decision,
        matchedCriteria: llm.matchedCriteria,
        missingCriteria: llm.missingCriteria,
        confidence: llm.confidence ?? 'MEDIUM',
        rationale: llm.rationale,
      }));

      // Merge: prefer AI results; keep heuristic results for any grantId not
      // returned by the AI (so known catalog entries aren't silently dropped).
      const aiIds = new Set(aiCandidates.map((c) => c.source.id));
      const heuristicOnly = heuristicCandidates.filter((c) => !aiIds.has(c.source.id));

      finalCandidates = [...aiCandidates, ...heuristicOnly].sort((a, b) => b.score - a.score);
    }
  } catch {
    // AI unavailable — heuristic results are already in finalCandidates
    provider = 'HEURISTIC';
  }

  return buildDiscoveryResult(input, finalCandidates, {
    provider,
    query,
    sourceSnapshotId,
    candidateCount: sources.length,
    returnedCount: finalCandidates.length,
    executedAt: new Date().toISOString(),
  });
}

export function createGrantDiscoverySearchProvider(): GrantDiscoverySearchProvider {
  return { discover: discoverAndEvaluateGrants };
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