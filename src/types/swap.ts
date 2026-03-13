/** Parameters for requesting a swap quote. */
export interface SwapQuoteRequest {
  inputMint: string;
  outputMint: string;
  /** Raw amount in smallest units (lamports / atomic units). */
  amount: string;
  /** Slippage tolerance in basis points (e.g. 50 = 0.5%). */
  slippageBps: number;
}

/** A single hop in the swap route. */
export interface RouteStep {
  ammLabel: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  percent: number;
}

/** Quote response from Jupiter Metis API. */
export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RouteStep[];
  /** The raw quote response object to pass back to the /swap endpoint. */
  rawQuoteResponse: unknown;
}

/** Result of executing a swap. */
export interface SwapResult {
  success: boolean;
  signature: string | null;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  error: string | null;
}
