import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { DISCOVERY_MODEL_NAME } from './discoveryModelConfig';
import { DISCOVERY_SYSTEM_PROMPT } from './discoveryPrompt';
import { DISCOVERY_SCORING_CONFIG } from './discoveryScoringConfig';
import { DISCOVERY_FALLBACK_SOURCE_CATALOG, GrantDiscoverySourceEntry } from './discoverySourceCatalog';
import { EligibilityDecision, EligibilityInput, ModificationCode } from './types';

export type GrantDiscoveryScope = 'MUNICIPAL' | 'PROVINCIAL' | 'NATIONAL';

export type GrantDiscoveryProvider = 'OPENAI' | 'HEURISTIC' | 'MOCK';

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
  estimatedFundingAmount: string | null;
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
  /**
   * Non-null only when the AI web-search path was attempted and failed (as opposed to being
   * disabled or unconfigured, which are expected skips).
   */
  aiFailureReason: string | null;
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
  estimatedFundingAmount?: string | null;
}

interface DiscoveryCandidateEvaluation {
  source: GrantDiscoverySourceEntry;
  score: number;
  decision: EligibilityDecision;
  matchedCriteria: string[];
  missingCriteria: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
  estimatedFundingAmount: string | null;
}

// ---------------------------------------------------------------------------
// Debug logger — set GRANT_DISCOVERY_DEBUG=false to silence
// ---------------------------------------------------------------------------

const DEBUG = (process.env.GRANT_DISCOVERY_DEBUG ?? 'true').toLowerCase() !== 'false';

function debug(tag: string, message: string, data?: unknown): void {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  const prefix = `[DISCOVERY:${tag}] ${ts}`;
  if (data !== undefined) {
    console.log(`${prefix} — ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} — ${message}`);
  }
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
  | 'provider'
  | 'query'
  | 'searchedScopes'
  | 'candidateCount'
  | 'returnedCount'
  | 'executedAt'
  | 'sourceSnapshotId'
  | 'aiFailureReason'
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

/**
 * Best-effort extraction of a funding figure from free-text catalog copy
 * (e.g. "up to $20,000 of eligible expenses"). Catalog/summary text is the
 * only place a dollar amount exists today — there's no structured field —
 * so this is a heuristic, not an authoritative parse; prefers an "up to $X"
 * phrase since that's how nearly every program describes its cap, falling
 * back to the first bare dollar figure in the text.
 */
function extractFundingAmount(text: string): string | null {
  const upToMatch = text.match(/\bup to \$[\d,]+(?:\.\d{2})?\b/i);
  if (upToMatch) return upToMatch[0];
  const dollarMatch = text.match(/\$[\d,]+(?:\.\d{2})?\b/);
  return dollarMatch ? dollarMatch[0] : null;
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

function buildSearchQueries(input: EligibilityInput): { scope: GrantDiscoveryScope; query: string }[] {
  const province = input.required.province ?? 'Canada';
  const city = input.optional.city?.trim();
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
      query: city
        ? `${city} ${province} municipal home accessibility grant program ${mods} 2024 2025`
        : `${province} municipal city home accessibility grant program ${mods} 2024 2025`,
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
// Catalog / source loading
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

/** Maximum ms to wait for any catalog URL before treating it as a failure. */
const CATALOG_FETCH_TIMEOUT_MS = 4000;

async function fetchCatalogFromUrl(source: GrantDiscoverySourceEntry): Promise<GrantDiscoverySourceEntry[]> {
  debug('CATALOG', `Fetching: ${source.sourceUrl}`);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(source.sourceUrl, {
        signal: controller.signal,
        headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      debug('CATALOG', `Fetch failed for ${source.sourceUrl}`, { status: response.status, statusText: response.statusText });
      return [];
    }

    const bodyText = await response.text();
    const trimmed = bodyText.trim();
    if (!trimmed) {
      debug('CATALOG', `Empty body for ${source.sourceUrl}`);
      return [];
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = parseCatalogPayload(JSON.parse(trimmed), source.sourceUrl);
        if (parsed.length > 0) {
          debug('CATALOG', `Parsed ${parsed.length} JSON entries from ${source.sourceUrl}`);
          return parsed;
        }
      } catch {
        debug('CATALOG', `JSON parse failed for ${source.sourceUrl} — falling back to HTML extraction`);
      }
    }

    const htmlEntry = {
      ...source,
      title: extractHtmlTitle(trimmed) ?? source.title,
      summary: extractMetaDescription(trimmed) ?? source.summary,
      content: trimmed,
    };
    debug('CATALOG', `HTML-backed entry for ${source.sourceUrl}`, { title: htmlEntry.title });
    return [htmlEntry];
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    debug('CATALOG', `${isTimeout ? 'Timeout' : 'Exception'} fetching ${source.sourceUrl}`, { error: String(err) });
    return [];
  }
}

/**
 * Load discovery sources by attempting to enrich each static catalog entry
 * with live content from its URL.
 *
 * Key behaviour change vs. the original:
 * - Every static entry is ALWAYS preserved, regardless of fetch outcome.
 * - A successful fetch only enriches `title`, `summary`, and `content` on
 *   the static entry — all structured fields (keywords, eligibleModificationCodes,
 *   requiresOwnerOccupied, etc.) are kept from the static catalog.
 * - 404s, exceptions, and empty responses silently fall back to the static entry.
 *
 * This means dead URLs no longer silently drop grants from heuristic scoring.
 */
async function loadDiscoverySources(): Promise<GrantDiscoverySourceEntry[]> {
  debug('SOURCES', `Fallback catalog size: ${DISCOVERY_FALLBACK_SOURCE_CATALOG.length}`);

  const liveSources = DISCOVERY_FALLBACK_SOURCE_CATALOG.filter(
    (source) => uniqueSourceUrls([source]).length > 0
  );
  debug('SOURCES', `Live sources with valid URLs: ${liveSources.length}`);

  // Fetch all sources in parallel, tracking which static entry each belongs to
  const fetchResults = await Promise.all(
    liveSources.map(async (source) => {
      const fetched = await fetchCatalogFromUrl(source);
      return { source, fetched };
    })
  );

  // Merge: enrich the static entry with live content where available,
  // but ALWAYS return the static entry as the base so no grants are dropped.
  const merged: GrantDiscoverySourceEntry[] = fetchResults.map(({ source, fetched }) => {
    if (fetched.length === 0) {
      // Fetch failed (404, exception, empty) — use static entry as-is
      debug('SOURCES', `Static fallback used for: ${source.id} (fetch returned nothing)`);
      return source;
    }

    // Enrich only the content/display fields — preserve all structured eligibility fields
    const live = fetched[0];
    const enriched: GrantDiscoverySourceEntry = {
      ...source,                                        // base: all structured fields from static catalog
      title: live.title ?? source.title,                // live title if available
      summary: live.summary ?? source.summary,          // live meta description if available
      content: live.content ?? source.content,          // live HTML body for better text-overlap scoring
    };
    debug('SOURCES', `Enriched with live content: ${source.id}`);
    return enriched;
  });

  const staticOnlyCount = fetchResults.filter(({ fetched }) => fetched.length === 0).length;
  debug('SOURCES', `Returning ${merged.length} merged source entries (${staticOnlyCount} static-only)`);
  
  return merged;
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

export function scoreCandidate(
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

  // A catalog entry with no overlap against the requested modification codes —
  // including one that deliberately sets eligibleModificationCodes: [] to mark
  // itself as not a modification-specific program (e.g. a devices/equipment
  // program) — can never actually fund this request. That must exclude the
  // candidate from ELIGIBLE outright, not just withhold the overlap bonus,
  // otherwise unrelated signals (jurisdiction, text/keyword overlap, ownership,
  // consent) can carry a mismatched program past eligibleThreshold on their own.
  const eligibleModificationCodes = uniqueStrings(source.eligibleModificationCodes ?? []);
  const requestedMods = input.required.modificationCodes;
  let modificationScopeExcluded = false;

  if (requestedMods.length > 0) {
    const overlapCount = requestedMods.filter((code) => eligibleModificationCodes.includes(code)).length;
    const overlapRatio = eligibleModificationCodes.length > 0 ? overlapCount / requestedMods.length : 0;

    if (overlapRatio > 0) {
      score += Math.round(overlapRatio * DISCOVERY_SCORING_CONFIG.modificationOverlapMaxPoints);
      matchedCriteria.push(`modification_overlap_${Math.round(overlapRatio * 100)}pct`);
    } else {
      modificationScopeExcluded = true;
      missingCriteria.push('no_modification_overlap');
    }
  }

  if (input.missingRequiredFields.length > 0) {
    score -= Math.min(
      input.missingRequiredFields.length * DISCOVERY_SCORING_CONFIG.missingFieldPenaltyPerField,
      DISCOVERY_SCORING_CONFIG.missingFieldPenaltyMax
    );
    missingCriteria.push('missing_required_application_fields');
  }

  const uncappedScore = Math.max(0, Math.min(100, score));
  const cappedScore = modificationScopeExcluded
    ? Math.min(uncappedScore, DISCOVERY_SCORING_CONFIG.eligibleThreshold - 1)
    : uncappedScore;

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

  debug('SCORE', `  ${source.id} → score=${cappedScore} decision=${decision}`, {
    matched: matchedCriteria,
    missing: missingCriteria,
  });

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
    estimatedFundingAmount: extractFundingAmount([source.summary, source.content ?? ''].join(' ')),
  };
}

// ---------------------------------------------------------------------------
// AI web-search discovery
// ---------------------------------------------------------------------------

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

interface OpenAiResponsesBody {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  output_text?: string;
  usage?: unknown;
}

function extractResponsesOutputText(body: OpenAiResponsesBody | null): string | null {
  if (!body) return null;

  if (typeof body.output_text === 'string' && body.output_text.trim().length > 0) {
    return body.output_text;
  }

  for (const item of body.output ?? []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if ((part.type === 'output_text' || part.type === 'text') && part.text?.trim()) {
        return part.text;
      }
    }
  }

  return null;
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function parseJsonObjectFromModelText(content: string): { decisions?: LlmGrantDecision[] } | null {
  const trimmed = content.trim();

  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    extractBalancedJsonObject(trimmed),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as { decisions?: LlmGrantDecision[] };
    } catch {
      // try next candidate
    }
  }

  return null;
}

interface OpenAiWebSearchOutcome {
  decisions: LlmGrantDecision[] | null;
  /**
   * Set only when the AI path was attempted and failed. Null for intentional skips
   * (no API key configured, AI disabled, or mock mode) — those are not failures.
   */
  failureReason: string | null;
  /** True when `decisions` came from the hardcoded GRANT_DISCOVERY_MOCK_AI catalog, not a live call. */
  isMock: boolean;
}

async function tryOpenAiWebSearch(
  input: EligibilityInput,
  fallbackCandidates: DiscoveryCandidateEvaluation[]
): Promise<OpenAiWebSearchOutcome> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    debug('AI', 'OPENAI_API_KEY not set — skipping AI web search');
    return { decisions: null, failureReason: null, isMock: false };
  }

  const enabled = (process.env.GRANT_DISCOVERY_AI_ENABLED ?? 'true').toLowerCase();
  if (enabled === 'false') {
    debug('AI', 'GRANT_DISCOVERY_AI_ENABLED=false — skipping AI web search');
    return { decisions: null, failureReason: null, isMock: false };
  }

  // -----------------------------------------------------------
  // MOCK MODE — set GRANT_DISCOVERY_MOCK_AI=true in .env to use
  // -----------------------------------------------------------
  if ((process.env.GRANT_DISCOVERY_MOCK_AI ?? 'false').toLowerCase() === 'true') {
    debug('AI', 'MOCK MODE — returning hardcoded decisions instead of calling OpenAI');
    return { failureReason: null, isMock: true, decisions: [{
        grantId: 'mock_hatc_canada',
        title: 'Home Accessibility Tax Credit (HATC) [MOCK]',
        scope: 'NATIONAL',
        jurisdiction: 'CA',
        sourceUrl: 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31285-home-accessibility-expenses.html',
        summary: 'Federal tax credit on up to $20,000 of eligible accessibility renovation expenses.',
        score: 85,
        decision: EligibilityDecision.ELIGIBLE,
        matchedCriteria: ['jurisdiction_match', 'modification_overlap', 'owner_occupied'],
        missingCriteria: [],
        confidence: 'HIGH',
        rationale: 'Mock: applicant meets federal HATC criteria based on province, ownership, and modification codes.',
        estimatedFundingAmount: 'Up to $20,000',
      },
      {
        grantId: 'mock_on_rrap',
        title: 'Ontario RRAP / IAH [MOCK]',
        scope: 'PROVINCIAL',
        jurisdiction: 'ON',
        sourceUrl: 'https://www.ontario.ca/page/investment-affordable-housing-program',
        summary: 'Ontario provincial funding for accessibility modifications for low-income homeowners.',
        score: 60,
        decision: EligibilityDecision.NEEDS_MORE_INFO,
        matchedCriteria: ['jurisdiction_match', 'modification_overlap'],
        missingCriteria: ['income_verification_required'],
        confidence: 'MEDIUM',
        rationale: 'Mock: jurisdiction and modifications match but income eligibility unconfirmed.',
        estimatedFundingAmount: null,
      },
      {
        grantId: 'mock_municipal_toronto',
        title: 'City of Toronto Home Improvement Program [MOCK]',
        scope: 'MUNICIPAL',
        jurisdiction: 'ON',
        sourceUrl: 'https://www.toronto.ca/community-people/housing-shelter/housing-support/home-improvement-programs-for-homeowners/',
        summary: 'Toronto forgivable loan for seniors and persons with disabilities.',
        score: 30,
        decision: EligibilityDecision.INELIGIBLE,
        matchedCriteria: ['modification_overlap'],
        missingCriteria: ['municipal_residency_unconfirmed', 'income_threshold_not_met'],
        confidence: 'LOW',
        rationale: 'Mock: modification codes match but residency and income criteria not confirmed.',
        estimatedFundingAmount: null,
      },
    ] };
  }

  const scopedQueries = buildSearchQueries(input);
  debug('AI', `Built ${scopedQueries.length} scoped queries`, scopedQueries);

  const profile = {
    province: input.required.province,
    ownershipStatus: input.required.ownershipStatus,
    consentConfirmed: input.required.clientConsentConfirmed,
    modificationCodes: input.required.modificationCodes,
    missingFields: input.missingRequiredFields,
  };
  debug('AI', 'Applicant profile', profile);

  const userMessage = JSON.stringify({
    profile,
    searchQueries: scopedQueries,
    instructions:
      'Search the web using each query in searchQueries. For every real program you find that funds ' +
      'home accessibility renovations or modifications, evaluate it against the applicant profile and ' +
      'include it in the decisions array. knownCandidates includes a fundsRequestedModifications flag ' +
      'per program from our own catalog data, for context. ' +
      'Assign a unique grantId (snake_case), set scope to MUNICIPAL/PROVINCIAL/NATIONAL, ' +
      'set jurisdiction to the ISO province code (e.g. "ON") or "CA" for national programs, ' +
      'and include the live sourceUrl where the grant was found. ' +
      'Return ONLY valid JSON: { "decisions": [ ...grant objects ] }',
    knownCandidates: fallbackCandidates.map((c) => ({
      grantId: c.source.id,
      title: c.source.title,
      scope: c.source.scope,
      jurisdiction: c.source.jurisdiction,
      sourceUrl: c.source.sourceUrl,
      baselineScore: c.score,
      fundsRequestedModifications: (c.source.eligibleModificationCodes ?? []).some((code) =>
        input.required.modificationCodes.includes(code as ModificationCode)
      ),
    })),
  });

  debug('AI', `Calling OpenAI Responses API — model: ${DISCOVERY_MODEL_NAME}`);

  const orgId = process.env.OPENAI_ORG_ID?.trim();

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(orgId ? { 'OpenAI-Organization': orgId } : {}),
    },
    body: JSON.stringify({
      model: DISCOVERY_MODEL_NAME,
      instructions: DISCOVERY_SYSTEM_PROMPT,
      input: userMessage,
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      tool_choice: 'required',
    }),
  });

  debug('AI', `OpenAI HTTP response: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errBody = await response.text().catch(() => '(unreadable)');
    debug('AI', 'OpenAI error body', { body: errBody });
    return {
      decisions: null,
      failureReason: `OpenAI API returned ${response.status} ${response.statusText}: ${errBody.slice(0, 300)}`,
      isMock: false,
    };
  }

  const body = (await response.json().catch(() => null)) as OpenAiResponsesBody | null;

  const content = extractResponsesOutputText(body);

  debug('AI', 'OpenAI response summary', {
    outputItemCount: body?.output?.length ?? 0,
    usage: body?.usage ?? null,
    contentPreview: content?.slice(0, 400) ?? null,
  });

  if (!content) {
    debug('AI', 'No content in response');
    return { decisions: null, failureReason: 'OpenAI response contained no output text', isMock: false };
  }

  let parsed: { decisions?: LlmGrantDecision[] } | null = null;
  try {
    parsed = parseJsonObjectFromModelText(content);
    debug('AI', `JSON parsed — decisions count: ${parsed?.decisions?.length ?? 'missing'}`);
  } catch (err) {
    debug('AI', 'JSON parse error', { error: String(err), raw: content.slice(0, 500) });
    return { decisions: null, failureReason: `Failed to parse JSON from OpenAI response: ${String(err)}`, isMock: false };
  }

  if (!parsed) {
    debug('AI', 'JSON parse error', { contentLength: content.length, raw: content.slice(0, 500) });
    return { decisions: null, failureReason: 'Failed to parse JSON from OpenAI response', isMock: false };
  }

  if (!Array.isArray(parsed.decisions)) {
    debug('AI', 'decisions is not an array', { parsed });
    return { decisions: null, failureReason: 'OpenAI response JSON did not contain a decisions array', isMock: false };
  }

  const valid = parsed.decisions.filter(
    (item) =>
      typeof item.grantId === 'string' &&
      typeof item.score === 'number' &&
      typeof item.decision === 'string' &&
      Array.isArray(item.matchedCriteria) &&
      Array.isArray(item.missingCriteria) &&
      typeof item.rationale === 'string'
  );

  const dropped = parsed.decisions.length - valid.length;
  if (dropped > 0) {
    debug('AI', `Dropped ${dropped} malformed decision(s)`);
  }

  debug('AI', `Returning ${valid.length} valid decisions`, valid.map((d) => ({
    grantId: d.grantId,
    title: d.title,
    scope: d.scope,
    score: d.score,
    decision: d.decision,
    sourceUrl: d.sourceUrl,
  })));

  if (valid.length === 0 && dropped > 0) {
    return { decisions: valid, failureReason: `All ${dropped} OpenAI decision(s) were malformed and dropped`, isMock: false };
  }

  return { decisions: valid, failureReason: null, isMock: false };
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

/**
 * Cross-checks discovered grants against our own catalog's known
 * `eligibleModificationCodes` for the same program (matched by grantId — the
 * AI reliably reuses catalog IDs when it recognizes a program it was given
 * as a candidate; see docs/grant-discovery-verification-2026-08-14.md). If a
 * grant is marked ELIGIBLE but the catalog says that program doesn't cover
 * any of the requested modification codes (including catalog entries whose
 * eligibleModificationCodes is deliberately empty, meaning "not a
 * modification-specific program"), that's an internal contradiction worth
 * flagging for manual review rather than trusting silently — this caught a
 * real, reproducible false positive (Ontario ADP marked eligible for
 * GRAB_BARS) during ground-truth verification.
 */
export function detectCatalogContradictions(
  discoveredGrants: DiscoveredGrant[],
  modificationCodes: ModificationCode[]
): DiscoveredGrant[] {
  return discoveredGrants.filter((grant) => {
    if (grant.decision !== EligibilityDecision.ELIGIBLE) return false;

    const catalogEntry = DISCOVERY_FALLBACK_SOURCE_CATALOG.find((entry) => entry.id === grant.grantId);
    if (!catalogEntry || !catalogEntry.eligibleModificationCodes) return false;

    const overlaps = catalogEntry.eligibleModificationCodes.some((code) =>
      modificationCodes.includes(code as ModificationCode)
    );
    return !overlaps;
  });
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
    estimatedFundingAmount: item.estimatedFundingAmount,
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

/**
 * Dedupes AI-returned candidates against themselves within a single response.
 * A single OpenAI web-search call can return the same program twice (observed
 * live: two identical "Home and Vehicle Modification Program | ontario.ca"
 * entries in one response) — the existing merge step only dedupes heuristic
 * candidates against AI ones, never the AI's own decisions against each
 * other. Matches first by grantId, then by normalized title + sourceUrl (in
 * case the model assigns differing grantIds to what's really the same
 * program), keeping the highest-scoring entry per match.
 */
export function dedupeAiCandidates(
  candidates: DiscoveryCandidateEvaluation[]
): DiscoveryCandidateEvaluation[] {
  const byKey = new Map<string, DiscoveryCandidateEvaluation>();
  const keyByTitleUrl = new Map<string, string>();

  for (const candidate of candidates) {
    const titleUrlKey = `${normalizeText(candidate.source.title)}::${candidate.source.sourceUrl.trim().toLowerCase()}`;
    const key = byKey.has(candidate.source.id)
      ? candidate.source.id
      : keyByTitleUrl.get(titleUrlKey) ?? candidate.source.id;

    const existing = byKey.get(key);
    if (!existing || candidate.score > existing.score) {
      byKey.set(key, candidate);
    }
    keyByTitleUrl.set(titleUrlKey, key);
  }

  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function discoverAndEvaluateGrants(
  input: EligibilityInput
): Promise<GrantDiscoveryEvaluationResult> {
  debug('MAIN', '=== discoverAndEvaluateGrants START ===', {
    province: input.required.province,
    ownershipStatus: input.required.ownershipStatus,
    modificationCodes: input.required.modificationCodes,
    missingRequiredFields: input.missingRequiredFields,
  });

  // Step 1: Load catalog sources for heuristic baseline
  const sources = await loadDiscoverySources();
  debug('MAIN', `Step 1 complete — loaded ${sources.length} source entries`);

  const query = buildSearchQuery(input);
  const queryTokens = tokenize(query); // extra security in case we allow for more flexible input in frontend
  debug('MAIN', `Heuristic query: "${query}"`, { queryTokens });

  // Step 2: Heuristic scoring
  debug('MAIN', `Step 2 — scoring ${sources.length} candidates heuristically...`);
  const heuristicCandidates = sources
    .map((source) => scoreCandidate(input, source, queryTokens))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  debug('MAIN', `Step 2 complete — top ${heuristicCandidates.length} heuristic candidates`, heuristicCandidates.map((c) => ({
    id: c.source.id,
    title: c.source.title,
    score: c.score,
    decision: c.decision,
  })));

  const sourceSnapshotId = calculateSourceSnapshotId(sources);
  debug('MAIN', `Source snapshot ID: ${sourceSnapshotId}`);

  let provider: GrantDiscoveryProvider = 'HEURISTIC';
  let finalCandidates = heuristicCandidates;
  let aiFailureReason: string | null = null;

  try {
    // Step 3: AI web search
    debug('MAIN', 'Step 3 — attempting AI web search...');
    const { decisions: llmDecisions, failureReason, isMock } = await tryOpenAiWebSearch(input, heuristicCandidates);
    aiFailureReason = failureReason;

    if (llmDecisions && llmDecisions.length > 0) {
      provider = isMock ? 'MOCK' : 'OPENAI';
      debug('MAIN', `AI returned ${llmDecisions.length} decisions — merging with heuristic results`);

      const aiCandidatesRaw: DiscoveryCandidateEvaluation[] = llmDecisions.map((llm) => ({
        source: {
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
        estimatedFundingAmount: llm.estimatedFundingAmount ?? null,
      }));

      const aiCandidates = dedupeAiCandidates(aiCandidatesRaw);
      if (aiCandidates.length < aiCandidatesRaw.length) {
        debug('MAIN', `Deduped AI response: ${aiCandidatesRaw.length} → ${aiCandidates.length}`);
      }

      const aiIds = new Set(aiCandidates.map((c) => c.source.id));
      const heuristicOnly = heuristicCandidates.filter((c) => !aiIds.has(c.source.id));
      debug('MAIN', `Merge: ${aiCandidates.length} AI + ${heuristicOnly.length} heuristic-only`);

      finalCandidates = [...aiCandidates, ...heuristicOnly].sort((a, b) => b.score - a.score);
    } else {
      debug('MAIN', 'AI returned no decisions — using heuristic candidates only');
    }
  } catch (err) {
    debug('MAIN', 'AI web search threw an exception — falling back to heuristic', { error: String(err) });
    provider = 'HEURISTIC';
    aiFailureReason = `Exception during AI web search: ${String(err)}`;
  }

  debug('MAIN', `Step 3 complete — provider=${provider}, finalCandidates=${finalCandidates.length}`, finalCandidates.map((c) => ({
    id: c.source.id,
    title: c.source.title,
    score: c.score,
    decision: c.decision,
  })));

  const result = buildDiscoveryResult(input, finalCandidates, {
    provider,
    query,
    sourceSnapshotId,
    candidateCount: sources.length,
    returnedCount: finalCandidates.length,
    executedAt: new Date().toISOString(),
    aiFailureReason: provider === 'HEURISTIC' ? aiFailureReason : null,
  });

  debug('MAIN', '=== discoverAndEvaluateGrants END ===', {
    overallDecision: result.overallDecision,
    reasonCodes: result.reasonCodes,
    grantCount: result.discoveredGrants.length,
    provider: result.discoveryMetadata.provider,
  });

  return result;
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
    aiFailureReason: overrides.aiFailureReason ?? null,
  };
}