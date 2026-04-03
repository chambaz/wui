import {
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { sendAndConfirmTransaction } from "../lib/confirm.js";
import type { SwapQuote, SwapResult } from "../types/swap.js";
import type { WalletProvider } from "../wallet/provider.js";
import { getSwapQuote } from "./quote.js";
import { buildSwapTransaction } from "./build.js";
import { resolveFeeAccount } from "./fees.js";

export async function executeSwap(
  quote: SwapQuote,
  provider: WalletProvider,
  rpc: Rpc<SolanaRpcApi>,
  apiKey: string,
  onStatus?: (status: string) => void,
): Promise<SwapResult> {
  let currentStep = "resolving fee account";
  try {
    const feeAccount = await resolveFeeAccount(rpc, quote.outputMint);

    let activeQuote = quote;
    if (!feeAccount) {
      currentStep = "re-quoting without fee";
      activeQuote = await getSwapQuote(
        {
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          amount: quote.inAmount,
          slippageBps: quote.slippageBps,
        },
        apiKey,
        false,
      );
    }

    currentStep = "building transaction";
    onStatus?.("Building transaction...");
    const swapResponse = await buildSwapTransaction(activeQuote, provider.publicKey, apiKey, feeAccount);

    currentStep = "signing transaction";
    onStatus?.("Signing transaction...");
    const signedBase64 = await provider.signTransactionBytes(
      new Uint8Array(Buffer.from(swapResponse.swapTransaction, "base64")),
    );

    currentStep = "sending transaction";
    onStatus?.("Broadcasting transaction...");
    const signature = await sendAndConfirmTransaction({
      rpc,
      signedTransaction: signedBase64,
      lastValidBlockHeight: BigInt(swapResponse.lastValidBlockHeight),
      expiredMessage: "Transaction expired before confirmation. The swap was not executed. Try again.",
    });

    return {
      success: true,
      signature,
      inputMint: activeQuote.inputMint,
      outputMint: activeQuote.outputMint,
      inAmount: activeQuote.inAmount,
      outAmount: activeQuote.outAmount,
      error: null,
    };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      signature: null,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      error: `Failed while ${currentStep}: ${raw}`,
    };
  }
}
