import type { TokenMetadata, TokenPrice } from "../types/portfolio.js";

const JUPITER_BASE_URL = "https://api.jup.ag";

/** Maximum number of mint IDs per Price API request. */
const PRICE_BATCH_SIZE = 50;

/** Default price cache TTL in milliseconds (30 seconds). */
const PRICE_CACHE_TTL_MS = 30_000;

// --- In-memory caches ---

let metadataCache: Map<string, TokenMetadata> = new Map();
let metadataCacheTime = 0;

/** Metadata cache is refreshed at most once per session (on first call). */
const METADATA_CACHE_TTL_MS = 5 * 60 * 1000;

interface PriceCacheEntry {
  price: TokenPrice;
  fetchedAt: number;
}

const priceCache: Map<string, PriceCacheEntry> = new Map();

// --- Helpers ---

function jupiterHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey };
}

// --- Token Metadata (Jupiter Tokens V2) ---

/** Raw shape from Jupiter Tokens V2 search endpoint. */
interface JupiterTokenV2 {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string;
}

function toTokenMetadata(raw: JupiterTokenV2): TokenMetadata {
  return {
    mint: raw.id,
    name: raw.name,
    symbol: raw.symbol,
    decimals: raw.decimals,
    iconUrl: raw.icon ?? null,
  };
}

/**
 * Fetch metadata for a list of mint addresses.
 * Uses the Tokens V2 search endpoint with comma-separated mints (max 100).
 * Results are cached in memory for the session.
 */
export async function fetchTokenMetadata(
  mints: string[],
  apiKey: string,
): Promise<Map<string, TokenMetadata>> {
  const now = Date.now();

  // Return cached results if all requested mints are cached and cache is fresh.
  const allCached = mints.every((m) => metadataCache.has(m));
  if (allCached && now - metadataCacheTime < METADATA_CACHE_TTL_MS) {
    return metadataCache;
  }

  // Fetch missing mints (or all if cache is stale).
  const toFetch = now - metadataCacheTime < METADATA_CACHE_TTL_MS
    ? mints.filter((m) => !metadataCache.has(m))
    : mints;

  if (toFetch.length === 0) return metadataCache;

  // Tokens V2 search supports up to 100 comma-separated mints.
  const batches: string[][] = [];
  for (let i = 0; i < toFetch.length; i += 100) {
    batches.push(toFetch.slice(i, i + 100));
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      const query = batch.join(",");
      const url = `${JUPITER_BASE_URL}/tokens/v2/search?query=${query}`;
      const res = await fetch(url, { headers: jupiterHeaders(apiKey) });

      if (!res.ok) {
        throw new Error(`Jupiter Tokens API error: ${res.status} ${res.statusText}`);
      }

      return (await res.json()) as JupiterTokenV2[];
    }),
  );

  for (const batch of results) {
    for (const token of batch) {
      metadataCache.set(token.id, toTokenMetadata(token));
    }
  }

  metadataCacheTime = now;
  return metadataCache;
}

/**
 * Look up metadata for a single mint from the cache.
 * Returns null if not cached — call fetchTokenMetadata first.
 */
export function getTokenMetadata(mint: string): TokenMetadata | null {
  return metadataCache.get(mint) ?? null;
}

// --- Token Prices (Jupiter Price V3) ---

/** Raw shape from Jupiter Price V3 endpoint (per OpenAPI spec). */
interface JupiterPriceV3Entry {
  createdAt: string;
  liquidity: number;
  usdPrice: number;
  blockId: number | null;
  decimals: number;
  priceChange24h: number | null;
}

/**
 * Fetch USD prices for a list of mint addresses.
 * Returns only mints for which a price was found.
 * Results are cached with a 30-second TTL.
 */
export async function fetchTokenPrices(
  mints: string[],
  apiKey: string,
): Promise<Map<string, TokenPrice>> {
  const now = Date.now();
  const result = new Map<string, TokenPrice>();
  const toFetch: string[] = [];

  // Use cached prices if still fresh.
  for (const mint of mints) {
    const cached = priceCache.get(mint);
    if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
      result.set(mint, cached.price);
    } else {
      toFetch.push(mint);
    }
  }

  if (toFetch.length === 0) return result;

  // Price V3 supports up to 50 mints per request.
  const batches: string[][] = [];
  for (let i = 0; i < toFetch.length; i += PRICE_BATCH_SIZE) {
    batches.push(toFetch.slice(i, i + PRICE_BATCH_SIZE));
  }

  const responses = await Promise.all(
    batches.map(async (batch) => {
      const ids = batch.join(",");
      const url = `${JUPITER_BASE_URL}/price/v3?ids=${ids}`;
      const res = await fetch(url, { headers: jupiterHeaders(apiKey) });

      if (!res.ok) {
        throw new Error(`Jupiter Price API error: ${res.status} ${res.statusText}`);
      }

      return (await res.json()) as Record<string, JupiterPriceV3Entry>;
    }),
  );

  for (const data of responses) {
    for (const [mint, entry] of Object.entries(data)) {
      if (!entry || typeof entry.usdPrice !== "number") continue;

      const price: TokenPrice = {
        mint,
        usdPrice: entry.usdPrice,
        priceChange24h: entry.priceChange24h ?? null,
      };

      priceCache.set(mint, { price, fetchedAt: now });
      result.set(mint, price);
    }
  }

  return result;
}
