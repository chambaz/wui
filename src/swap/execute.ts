import {
  type Rpc,
  type SolanaRpcApi,
  type KeyPairSigner,
  type Base64EncodedWireTransaction,
  getTransactionDecoder,
  getBase64EncodedWireTransaction,
  signTransaction,
} from "@solana/kit";
import { formatTransactionError } from "../lib/errors.js";
import type { SwapQuote, SwapResult } from "../types/swap.js";
import { getSwapQuote } from "./quote.js";
import { buildSwapTransaction } from "./build.js";
import { resolveFeeAccount } from "./fees.js";
import { CONFIRMATION_POLL_INTERVAL_MS, CONFIRMATION_TIMEOUT_MS } from "./constants.js";

async function signSwapTransaction(
  base64Transaction: string,
  signer: KeyPairSigner,
): Promise<Base64EncodedWireTransaction> {
  const decoder = getTransactionDecoder();
  const txBytes = new Uint8Array(Buffer.from(base64Transaction, "base64"));
  const transaction = decoder.decode(txBytes);
  const signed = await signTransaction([signer.keyPair], transaction);
  return getBase64EncodedWireTransaction(signed);
}

async function sendAndConfirm(
  rpc: Rpc<SolanaRpcApi>,
  signedBase64: Base64EncodedWireTransaction,
  lastValidBlockHeight: number,
): Promise<string> {
  const signature = await rpc
    .sendTransaction(signedBase64, { encoding: "base64", skipPreflight: true })
    .send();

  const startTime = Date.now();
  while (Date.now() - startTime < CONFIRMATION_TIMEOUT_MS) {
    const blockHeight = await rpc.getBlockHeight().send();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error("Transaction expired before confirmation. The swap was not executed. Try again.");
    }

    const { value: statuses } = await rpc.getSignatureStatuses([signature]).send();
    const status = statuses[0];
    if (status) {
      if (status.err) {
        throw new Error(formatTransactionError(status.err));
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return signature;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS));
  }

  throw new Error(`Transaction confirmation timed out. Check status manually: ${signature}`);
}

export async function executeSwap(
  quote: SwapQuote,
  signer: KeyPairSigner,
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
    const signature = await sendAndConfirm(rpc, signedBase64, swapResponse.lastValidBlockHeight);

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
