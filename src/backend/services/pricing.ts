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

async function fetchFromSerpAPI(query: string): Promise<PriceResult> {
  const apiKey = process.env.SERP_API_KEY;
  const startedAt = Date.now();

  if (!apiKey) {
    logQueryCost({ query, outcome: "missing_key", latencyMs: 0 });
    throw new Error("Missing SERP_API_KEY");
  }

  // sort_by=1 = "Price: low to high" — shopping_results below comes back price-ascending,
  // which the best-match loop relies on to break early on the first preferred-store hit.
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
    return emptyResult(query, "empty");
  }

  // Best result is the lowest price
  let best = null;

  for (const item of results) {
    const price = parsePrice(item.price);

    if (!price) continue;

    if (isPreferredStore(item.source)) {
      best = item;
      break;
    }

    if (!best) {
      best = item;
    }
  }

  if (!best) {
    logQueryCost({ query, outcome: "empty", httpStatus: res.status, latencyMs });
    return emptyResult(query, "empty");
  }

  logQueryCost({ query, outcome: "success", httpStatus: res.status, latencyMs });

  return {
    name: best.title || query,
    price: parsePrice(best.price),
    currency: best.price || null,
    store: best.source || null,
    link: best.link || null,
    thumbnail: best.thumbnail || null,
    query,
    fetchedAt: new Date().toISOString(),
    status: "ok",
  };
}

export async function getMaterialPrice(query: string): Promise<PriceResult> {

  if (!query || query.trim().length === 0) {
    throw new Error("Invalid query");
  }

  try {
    return await fetchFromSerpAPI(query);
  } catch (error) {
    console.error("Pricing service error:", error);

    return emptyResult(query, "error");
  }
}
