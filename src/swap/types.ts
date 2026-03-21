import type { RouteStep, SwapQuote } from "../types/swap.js";

export interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label?: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
    };
    percent: number;
  }>;
}

export interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

export function toSwapQuote(raw: JupiterQuoteResponse): SwapQuote {
  const routePlan: RouteStep[] = raw.routePlan.map((step) => ({
    ammLabel: step.swapInfo.label ?? "Unknown",
    inputMint: step.swapInfo.inputMint,
    outputMint: step.swapInfo.outputMint,
    inAmount: step.swapInfo.inAmount,
    outAmount: step.swapInfo.outAmount,
    percent: step.percent,
  }));

  return {
    inputMint: raw.inputMint,
    outputMint: raw.outputMint,
    inAmount: raw.inAmount,
    outAmount: raw.outAmount,
    otherAmountThreshold: raw.otherAmountThreshold,
    slippageBps: raw.slippageBps,
    priceImpactPct: raw.priceImpactPct,
    routePlan,
    rawQuoteResponse: raw,
  };
}
