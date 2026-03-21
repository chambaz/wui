import type { TokenMetadata, TokenPrice } from "../types/portfolio.js";

export const PRICE_BATCH_SIZE = 50;
export const PRICE_CACHE_TTL_MS = 30_000;
export const METADATA_CACHE_TTL_MS = 5 * 60 * 1000;

export interface PriceCacheEntry {
  price: TokenPrice;
  fetchedAt: number;
}

export interface JupiterTokenV2 {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string;
}

export interface JupiterPriceV3Entry {
  createdAt: string;
  liquidity: number;
  usdPrice: number;
  blockId: number | null;
  decimals: number;
  priceChange24h: number | null;
}

export const metadataCache: Map<string, TokenMetadata> = new Map();
export let metadataCacheTime = 0;
export const priceCache: Map<string, PriceCacheEntry> = new Map();

export function setMetadataCacheTime(value: number): void {
  metadataCacheTime = value;
}

export function toTokenMetadata(raw: JupiterTokenV2): TokenMetadata {
  return {
    mint: raw.id,
    name: raw.name,
    symbol: raw.symbol,
    decimals: raw.decimals,
    iconUrl: raw.icon ?? null,
  };
}
