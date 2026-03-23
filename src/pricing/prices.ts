import { fetchWithTimeout } from "../lib/errors.js";
import { JUPITER_BASE_URL } from "../lib/format.js";
import type { TokenPrice } from "../types/portfolio.js";
import {
  type JupiterPriceV3Entry,
  PRICE_BATCH_SIZE,
  PRICE_CACHE_TTL_MS,
  priceCache,
} from "./cache.js";

export async function fetchTokenPrices(
  mints: string[],
  apiKey: string,
): Promise<Map<string, TokenPrice>> {
  const now = Date.now();
  const result = new Map<string, TokenPrice>();
  const toFetch: string[] = [];

  for (const mint of mints) {
    const cached = priceCache.get(mint);
    if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
      result.set(mint, cached.price);
    } else {
      toFetch.push(mint);
    }
  }

  if (toFetch.length === 0) return result;

  const batches: string[][] = [];
  for (let i = 0; i < toFetch.length; i += PRICE_BATCH_SIZE) {
    batches.push(toFetch.slice(i, i + PRICE_BATCH_SIZE));
  }

  const responses = await Promise.all(
    batches.map(async (batch) => {
      const ids = batch.join(",");
      const url = `${JUPITER_BASE_URL}/price/v3?ids=${ids}`;
      const res = await fetchWithTimeout(url, { headers: { "x-api-key": apiKey } }, "Jupiter API");

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
