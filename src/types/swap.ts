/** Parameters for requesting a swap quote. */
export interface SwapQuoteRequest {
  inputMint: string;
  outputMint: string;
  /** Raw amount in smallest units (lamports / atomic units). */
  amount: string;
  /** Max slippage tolerance in basis points (e.g. 50 = 0.5%). */
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

export type MultiSwapMode = "dust" | "split";

export interface MultiSwapLeg {
  index: number;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  requestedInAmount: string;
  quoteRequest: SwapQuoteRequest;
}

export interface MultiSwapSkippedLeg {
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  requestedInAmount: string;
  reason: string;
}

export interface MultiSwapPlanSummary {
  legsPlanned: number;
  legsSkipped: number;
}

export interface MultiSwapPlan {
  mode: MultiSwapMode;
  sequential: true;
  continueOnFailure: boolean;
  summary: MultiSwapPlanSummary;
  legs: MultiSwapLeg[];
  skipped: MultiSwapSkippedLeg[];
}

export interface MultiSwapLegExecutionResult {
  leg: MultiSwapLeg;
  quote: SwapQuote | null;
  result: SwapResult;
}

export interface MultiSwapUnattemptedLeg {
  leg: MultiSwapLeg;
  reason: string;
}

export interface MultiSwapExecutionSummary {
  legsPlanned: number;
  legsSkipped: number;
  legsSucceeded: number;
  legsFailed: number;
  legsUnattempted: number;
}

export interface MultiSwapExecutionResult {
  mode: MultiSwapMode;
  sequential: true;
  summary: MultiSwapExecutionSummary;
  skipped: MultiSwapSkippedLeg[];
  legs: MultiSwapLegExecutionResult[];
  unattempted: MultiSwapUnattemptedLeg[];
}
