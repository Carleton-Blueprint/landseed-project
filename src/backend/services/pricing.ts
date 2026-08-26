type PriceResultStatus = "ok" | "empty" | "error";

type PriceResult = {
  name: string;
  price: number | null;
  currency: string | null;
  store: string | null;
  link: string | null;
  thumbnail: string | null;
  query: string;
  fetchedAt: string;
  status: PriceResultStatus;
};

export interface PriceCandidate {
  name: string;
  price: number;
  currency: string | null;
  store: string | null;
  link: string | null;
  thumbnail: string | null;
  isPreferredStore: boolean;
}

export interface PriceCandidatesResult {
  query: string;
  status: PriceResultStatus;
  candidates: PriceCandidate[];
  fetchedAt: string;
}

const preferredStores = [
  "home depot",
  "lowe",
  "rona",
];

// SerpAPI does not return per-request cost; this is an operator-configured estimate
// used to attribute spend per query for cost tracking. Currently $0 (free tier) —
// update SERP_API_COST_PER_QUERY when/if the account moves to a paid plan.
const DEFAULT_SERP_API_COST_PER_QUERY_USD = 0;
const SERP_API_TIMEOUT_MS = 8000;

const DEBUG = (process.env.PRICING_DEBUG ?? "true").toLowerCase() !== "false";

function debug(tag: string, message: string, data?: unknown): void {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  const prefix = `[PRICING:${tag}] ${ts}`;
  if (data !== undefined) {
    console.log(`${prefix} — ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} — ${message}`);
  }
}

function getCostPerQuery(): number {
  const configured = parseFloat(process.env.SERP_API_COST_PER_QUERY ?? "");
  return isNaN(configured) ? DEFAULT_SERP_API_COST_PER_QUERY_USD : configured;
}

function logQueryCost(input: {
  query: string;
  outcome: "success" | "empty" | "http_error" | "network_error" | "missing_key";
  httpStatus?: number;
  latencyMs: number;
}): void {
  const billed = input.outcome === "success" || input.outcome === "empty" || input.outcome === "http_error";
  const estimatedCostUsd = billed ? getCostPerQuery() : 0;

  debug("COST", `query="${input.query}" outcome=${input.outcome} latencyMs=${input.latencyMs} estimatedCostUsd=${estimatedCostUsd}`, {
    httpStatus: input.httpStatus ?? null,
  });
}

function emptyResult(query: string, status: PriceResultStatus): PriceResult {
  return {
    name: query,
    price: null,
    currency: null,
    store: null,
    link: null,
    thumbnail: null,
    query,
    fetchedAt: new Date().toISOString(),
    status,
  };
}

function emptyCandidatesResult(query: string, status: PriceResultStatus): PriceCandidatesResult {
  return {
    query,
    status,
    candidates: [],
    fetchedAt: new Date().toISOString(),
  };
}

function parsePrice(priceStr: string | undefined): number | null {
  if (!priceStr) return null;

  const cleaned = priceStr.replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);

  return isNaN(parsed) ? null : parsed;
}

function isPreferredStore(source: string | undefined): boolean {
  if (!source) return false;

  const lower = source.toLowerCase();
  return preferredStores.some((store) => lower.includes(store));
}

// Picks the same match the old single-result lookup did: the cheapest preferred-store
// candidate if one exists, else the cheapest candidate overall. Relies on `candidates`
// already being price-ascending (see sort_by=1 note below).
export function pickBestCandidate(candidates: PriceCandidate[]): PriceCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.find((candidate) => candidate.isPreferredStore) ?? candidates[0];
}

async function fetchCandidatesFromSerpAPI(query: string, floorPrice?: number): Promise<PriceCandidatesResult> {
  const apiKey = process.env.SERP_API_KEY;
  const startedAt = Date.now();

  if (!apiKey) {
    logQueryCost({ query, outcome: "missing_key", latencyMs: 0 });
    throw new Error("Missing SERP_API_KEY");
  }

  // sort_by=1 = "Price: low to high" — shopping_results below comes back price-ascending,
  // which pickBestCandidate relies on to break early on the first preferred-store hit.
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(
    query
  )}&gl=ca&hl=en&location=Ottawa,+Ontario,+Canada&sort_by=1&api_key=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERP_API_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isTimeout = err instanceof Error && err.name === "AbortError";
    logQueryCost({ query, outcome: "network_error", latencyMs });
    debug("FETCH", `${isTimeout ? "Timeout" : "Network error"} for query="${query}"`, { error: String(err) });
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    logQueryCost({ query, outcome: "http_error", httpStatus: res.status, latencyMs });
    throw new Error(`SerpAPI request failed: ${res.status}`);
  }

  const data = await res.json();
  const results = data.shopping_results;

  if (!results || results.length === 0) {
    logQueryCost({ query, outcome: "empty", httpStatus: res.status, latencyMs });
    return emptyCandidatesResult(query, "empty");
  }

  const candidates: PriceCandidate[] = [];

  for (const item of results) {
    const price = parsePrice(item.price);

    if (!price) continue;
    if (floorPrice !== undefined && price < floorPrice) continue;

    candidates.push({
      name: item.title || query,
      price,
      currency: item.price || null,
      store: item.source || null,
      link: item.product_link || null,
      thumbnail: item.thumbnail || null,
      isPreferredStore: isPreferredStore(item.source),
    });
  }

  if (candidates.length === 0) {
    logQueryCost({ query, outcome: "empty", httpStatus: res.status, latencyMs });
    return emptyCandidatesResult(query, "empty");
  }

  logQueryCost({ query, outcome: "success", httpStatus: res.status, latencyMs });

  return {
    query,
    status: "ok",
    candidates,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getMaterialPrice(query: string): Promise<PriceResult> {

  if (!query || query.trim().length === 0) {
    throw new Error("Invalid query");
  }

  try {
    const result = await fetchCandidatesFromSerpAPI(query);
    const best = pickBestCandidate(result.candidates);

    if (!best) {
      return emptyResult(query, "empty");
    }

    return {
      name: best.name,
      price: best.price,
      currency: best.currency,
      store: best.store,
      link: best.link,
      thumbnail: best.thumbnail,
      query,
      fetchedAt: result.fetchedAt,
      status: "ok",
    };
  } catch (error) {
    console.error("Pricing service error:", error);

    return emptyResult(query, "error");
  }
}

/**
 * Like getMaterialPrice, but returns every parsed shopping result (price-ascending)
 * instead of collapsing to a single best match — lets a caller pick several distinct
 * price points (e.g. tiered pricing) from one SerpAPI query. Pass floorPrice to drop
 * results priced implausibly below a known anchor before they're returned.
 */
export async function getMaterialPriceCandidates(
  query: string,
  options?: { floorPrice?: number }
): Promise<PriceCandidatesResult> {

  if (!query || query.trim().length === 0) {
    throw new Error("Invalid query");
  }

  try {
    return await fetchCandidatesFromSerpAPI(query, options?.floorPrice);
  } catch (error) {
    console.error("Pricing service error:", error);

    return emptyCandidatesResult(query, "error");
  }
}
