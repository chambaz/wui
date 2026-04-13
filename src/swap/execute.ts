import {
  type Rpc,
  type SolanaRpcApi,
  type Base64EncodedWireTransaction,
  getTransactionDecoder,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { sendAndConfirmTransaction } from "../lib/confirm.js";
import type { WalletSigner } from "../types/wallet-signer.js";
import type { SwapQuote, SwapResult } from "../types/swap.js";
import { getSwapQuote } from "./quote.js";
import { buildSwapTransaction } from "./build.js";
import { resolveFeeAccount } from "./fees.js";

async function signSwapTransaction(
  base64Transaction: string,
  signer: WalletSigner,
): Promise<Base64EncodedWireTransaction> {
  const decoder = getTransactionDecoder();
  const txBytes = new Uint8Array(Buffer.from(base64Transaction, "base64"));
  const transaction = decoder.decode(txBytes);
  const [signatures] = await signer.signTransactions([transaction]);
  const signed = {
    ...transaction,
    signatures: {
      ...(transaction.signatures ?? {}),
      ...signatures,
    },
  };
  return getBase64EncodedWireTransaction(signed as never);
}

export async function executeSwap(
  quote: SwapQuote,
  signer: WalletSigner,
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
    const swapResponse = await buildSwapTransaction(activeQuote, signer.address, apiKey, feeAccount);

    currentStep = "signing transaction";
    onStatus?.("Signing transaction...");
    const signedBase64 = await signSwapTransaction(swapResponse.swapTransaction, signer);

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
