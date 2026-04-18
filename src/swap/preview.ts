import type {
  MultiSwapLeg,
  MultiSwapPlan,
  MultiSwapPreviewLeg,
  MultiSwapPreviewResult,
} from "../types/swap.js";
import { getSwapQuote } from "./quote.js";

function buildSkippedLegFromPlan(leg: MultiSwapLeg, reason: string) {
  return {
    inputMint: leg.inputMint,
    outputMint: leg.outputMint,
    inputSymbol: leg.inputSymbol,
    outputSymbol: leg.outputSymbol,
    requestedInAmount: leg.requestedInAmount,
    reason,
  };
}

export async function previewDustSwapPlan(
  plan: MultiSwapPlan,
  apiKey: string,
): Promise<MultiSwapPreviewResult> {
  const previewLegs: MultiSwapPreviewLeg[] = [];
  const executionLegs: MultiSwapLeg[] = [];
  const skipped = [...plan.skipped];

  for (const leg of plan.legs) {
    try {
      const quote = await getSwapQuote(leg.quoteRequest, apiKey);
      previewLegs.push({ leg, quote });
      executionLegs.push(leg);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      skipped.push(buildSkippedLegFromPlan(leg, message));
    }
  }

  if (executionLegs.length === 0) {
    throw new Error("No routable dust swaps found. Try a different destination token or threshold.");
  }

  return {
    previewLegs,
    executionPlan: {
      ...plan,
      summary: {
        legsPlanned: executionLegs.length,
        legsSkipped: skipped.length,
      },
      legs: executionLegs,
      skipped,
    },
  };
}

export async function previewStrictMultiSwapPlan(
  plan: MultiSwapPlan,
  apiKey: string,
): Promise<MultiSwapPreviewResult> {
  const previewLegs: MultiSwapPreviewLeg[] = [];

  for (const leg of plan.legs) {
    try {
      const quote = await getSwapQuote(leg.quoteRequest, apiKey);
      previewLegs.push({ leg, quote });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not quote leg ${leg.index + 1} (${leg.outputSymbol}): ${message}`);
    }
  }

  return {
    executionPlan: plan,
    previewLegs,
  };
}
