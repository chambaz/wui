/** A single token holding in the portfolio. */
export type AssetKind = "native-sol" | "wrapped-sol" | "token";

export interface TokenBalance {
  /** Stable unique identity for this balance row. */
  id: string;
  /** Mint address (native SOL uses the wrapped SOL mint). */
  mint: string;
  /** Token account address for SPL balances, null for native SOL. */
  accountAddress: string | null;
  /** Owning token program for SPL balances, null for native SOL. */
  tokenProgram: string | null;
  /** Display classification used to distinguish SOL from WSOL. */
  assetKind: AssetKind;
  /** Raw on-chain balance (before decimal normalization). */
  rawBalance: bigint;
  /** Token decimals. */
  decimals: number;
  /** Human-readable balance (rawBalance / 10^decimals). */
  balance: number;
  /** True for native SOL (not a token account). */
  isNative: boolean;
}

/** Token metadata from Jupiter Tokens API V2. */
export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  iconUrl: string | null;
}

/** Price data from Jupiter Price API V3. */
export interface TokenPrice {
  mint: string;
  /** USD price. */
  usdPrice: number;
  /** 24-hour price change percentage. */
  priceChange24h: number | null;
}

/** Fully enriched portfolio row combining balance, metadata, and price. */
export interface PortfolioRow {
  id: string;
  mint: string;
  accountAddress: string | null;
  assetKind: AssetKind;
  symbol: string;
  name: string;
  iconUrl: string | null;
  balance: number;
  decimals: number;
  isNative: boolean;
  usdPrice: number | null;
  usdValue: number | null;
  priceChange24h: number | null;
}

/** Aggregate portfolio summary. */
export interface PortfolioSummary {
  totalValue: number;
  /** Estimated 24h change in USD. */
  change24h: number;
  /** Estimated 24h change as a percentage of total value. */
  changePercent24h: number | null;
}

export interface SelectedAssetRef {
  id: string;
  mint: string;
  assetKind: AssetKind;
}
