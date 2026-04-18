import type { Rpc, SolanaRpcApi } from "@solana/kit";
import type { MultiSwapExecutionResult, MultiSwapPlan, SwapResult } from "../types/swap.js";
import type { WalletSigner } from "../types/wallet-signer.js";
import { executeSwap } from "./execute.js";
import { getSwapQuote } from "./quote.js";

function buildExecutionResult(plan: MultiSwapPlan): MultiSwapExecutionResult {
  return {
    mode: plan.mode,
    sequential: true,
    summary: {
      legsPlanned: plan.summary.legsPlanned,
      legsSkipped: plan.summary.legsSkipped,
      legsSucceeded: 0,
      legsFailed: 0,
    },
    skipped: plan.skipped,
    legs: [],
  };
}

function buildLegFailure(
  inputMint: string,
  outputMint: string,
  inAmount: string,
  error: string,
): SwapResult {
  return {
    success: false,
    signature: null,
    inputMint,
    outputMint,
    inAmount,
    outAmount: "0",
    error,
  };
}

export async function executeMultiSwapPlan(
  plan: MultiSwapPlan,
  signer: WalletSigner,
  rpc: Rpc<SolanaRpcApi>,
  apiKey: string,
  onStatus?: (status: string) => void,
): Promise<MultiSwapExecutionResult> {
  const execution = buildExecutionResult(plan);

  for (const leg of plan.legs) {
    const label = `Leg ${leg.index + 1}/${plan.legs.length}`;

    try {
      onStatus?.(`${label}: fetching quote...`);
      const quote = await getSwapQuote(leg.quoteRequest, apiKey);

      const result = await executeSwap(
        quote,
        signer,
        rpc,
        apiKey,
        onStatus ? (status) => onStatus(`${label}: ${status}`) : undefined,
      );

      execution.legs.push({
        leg,
        quote,
        result,
      });

      if (result.success) {
        execution.summary.legsSucceeded += 1;
      } else {
        execution.summary.legsFailed += 1;
        if (!plan.continueOnFailure) {
          break;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      execution.legs.push({
        leg,
        quote: null,
        result: buildLegFailure(
          leg.inputMint,
          leg.outputMint,
          leg.requestedInAmount,
          message,
        ),
      });
      execution.summary.legsFailed += 1;

      if (!plan.continueOnFailure) {
        break;
      }
    }
  }

  return execution;
}
