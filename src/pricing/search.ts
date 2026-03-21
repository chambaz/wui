import { fetchWithTimeout } from "../lib/errors.js";
import { JUPITER_BASE_URL } from "../lib/format.js";
import type { TokenMetadata } from "../types/portfolio.js";
import { type JupiterTokenV2, toTokenMetadata } from "./cache.js";

function jupiterHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey };
}

export async function searchTokens(query: string, apiKey: string): Promise<TokenMetadata[]> {
  try {
    const url = `${JUPITER_BASE_URL}/tokens/v2/search?query=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, { headers: jupiterHeaders(apiKey) }, "Jupiter API");
    if (!res.ok) return [];
    const tokens = (await res.json()) as JupiterTokenV2[];
    return tokens.map(toTokenMetadata);
  } catch {
    return [];
  }
}
