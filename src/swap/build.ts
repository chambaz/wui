import { JUPITER_BASE_URL } from "../lib/format.js";
import { fetchWithTimeout } from "../lib/errors.js";
import { MAX_PRIORITY_FEE_LAMPORTS } from "./constants.js";
import type { JupiterSwapResponse } from "./types.js";
import type { SwapQuote } from "../types/swap.js";

export async function buildSwapTransaction(
  quote: SwapQuote,
  userPublicKey: string,
  apiKey: string,
  feeAccount: string | null,
): Promise<JupiterSwapResponse> {
  const body: Record<string, unknown> = {
    quoteResponse: quote.rawQuoteResponse,
    userPublicKey,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        priorityLevel: "veryHigh",
        maxLamports: MAX_PRIORITY_FEE_LAMPORTS,
      },
    },
  };

  if (feeAccount) body.feeAccount = feeAccount;

  const res = await fetchWithTimeout(`${JUPITER_BASE_URL}/swap/v1/swap`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, "Jupiter API");

  if (!res.ok) {
    if (res.status === 429) throw new Error("Jupiter API rate limited. Wait a moment and try again.");
    throw new Error(`Failed to build swap transaction (${res.status}). Try again.`);
  }

  return (await res.json()) as JupiterSwapResponse;
}
