type PriceResult = {
  name: string;
  price: number | null;
  currency: string | null;
  store: string | null;
  link: string | null;
  thumbnail: string | null;
  query: string;
  fetchedAt: string;
};

const preferredStores = [
  "home depot",
  "lowe",
  "rona",
];

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

  if (!apiKey) {
    throw new Error("Missing SERP_API_KEY");
  }

  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(
    query
  )}&gl=ca&hl=en&location=Ottawa,+Ontario,+Canada&sort_by=1&api_key=${apiKey}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`SerpAPI request failed: ${res.status}`);
  }

  const data = await res.json();
  const results = data.shopping_results;

  if (!results || results.length === 0) {
    return {
      name: query,
      price: null,
      currency: null,
      store: null,
      link: null,
      thumbnail: null,
      query,
      fetchedAt: new Date().toISOString(),
    };
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
    return {
      name: query,
      price: null,
      currency: null,
      store: null,
      link: null,
      thumbnail: null,
      query,
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    name: best.title || query,
    price: parsePrice(best.price),
    currency: best.price || null,
    store: best.source || null,
    link: best.link || null,
    thumbnail: best.thumbnail || null,
    query,
    fetchedAt: new Date().toISOString(),
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

    return {
      name: query,
      price: null,
      currency: null,
      store: null,
      link: null,
      thumbnail: null,
      query,
      fetchedAt: new Date().toISOString(),
    };
  }
}
