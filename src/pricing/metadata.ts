import { fetchWithTimeout } from "../lib/errors.js";
import { JUPITER_BASE_URL } from "../lib/format.js";
import type { TokenMetadata } from "../types/portfolio.js";
import {
  type JupiterTokenV2,
  metadataCache,
  metadataCacheTime,
  METADATA_CACHE_TTL_MS,
  setMetadataCacheTime,
  toTokenMetadata,
} from "./cache.js";

function jupiterHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey };
}

export async function fetchTokenMetadata(
  mints: string[],
  apiKey: string,
): Promise<Map<string, TokenMetadata>> {
  const now = Date.now();
  const allCached = mints.every((m) => metadataCache.has(m));
  if (allCached && now - metadataCacheTime < METADATA_CACHE_TTL_MS) {
    return metadataCache;
  }

  const toFetch = now - metadataCacheTime < METADATA_CACHE_TTL_MS
    ? mints.filter((m) => !metadataCache.has(m))
    : mints;

  if (toFetch.length === 0) return metadataCache;

  const batches: string[][] = [];
  for (let i = 0; i < toFetch.length; i += 100) {
    batches.push(toFetch.slice(i, i + 100));
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      const query = batch.join(",");
      const url = `${JUPITER_BASE_URL}/tokens/v2/search?query=${query}`;
      const res = await fetchWithTimeout(url, { headers: jupiterHeaders(apiKey) }, "Jupiter API");

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

  setMetadataCacheTime(now);
  return metadataCache;
}

export function getTokenMetadata(mint: string): TokenMetadata | null {
  return metadataCache.get(mint) ?? null;
}
