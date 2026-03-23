import type { SwapQuoteRequest } from "../types/swap.js";
import { fetchWithTimeout } from "../lib/errors.js";
import { JUPITER_BASE_URL } from "../lib/format.js";
import { PLATFORM_FEE_BPS } from "./constants.js";
import { type JupiterQuoteResponse, toSwapQuote } from "./types.js";

export async function getSwapQuote(
  request: SwapQuoteRequest,
  apiKey: string,
  includePlatformFee = true,
) {
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    slippageBps: String(request.slippageBps),
    restrictIntermediateTokens: "true",
  });
  if (includePlatformFee) {
    params.set("platformFeeBps", String(PLATFORM_FEE_BPS));
  }

  const url = `${JUPITER_BASE_URL}/swap/v1/quote?${params}`;
  const res = await fetchWithTimeout(url, { headers: { "x-api-key": apiKey } }, "Jupiter API");

  if (!res.ok) {
    if (res.status === 429) throw new Error("Jupiter API rate limited. Wait a moment and try again.");
    throw new Error(`Jupiter quote failed (${res.status}). Try again.`);
  }

  const raw = (await res.json()) as JupiterQuoteResponse;
  return toSwapQuote(raw);
}
