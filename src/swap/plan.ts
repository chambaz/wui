import { parseDecimalAmount } from "../lib/format.js";
import { MIN_SOL_RESERVE_LAMPORTS } from "../transfer/constants.js";
import { maxSendableSol } from "../transfer/index.js";
import type { TokenBalance, TokenMetadata, TokenPrice } from "../types/portfolio.js";
import type {
  MultiSwapLeg,
  MultiSwapPlan,
  MultiSwapSkippedLeg,
  SwapQuoteRequest,
} from "../types/swap.js";
import { MAX_PRIORITY_FEE_LAMPORTS } from "./constants.js";

const PERCENT_SCALE = 100;
const PERCENT_SCALE_FACTOR = 100n;
const MULTI_SWAP_SOL_FEE_BUFFER_LAMPORTS_PER_LEG = MIN_SOL_RESERVE_LAMPORTS > BigInt(MAX_PRIORITY_FEE_LAMPORTS)
  ? MIN_SOL_RESERVE_LAMPORTS
  : BigInt(MAX_PRIORITY_FEE_LAMPORTS);

export interface DustSwapPlanRequest {
  balances: TokenBalance[];
  metadata: Map<string, TokenMetadata>;
  prices: Map<string, TokenPrice>;
  destinationMint: string;
  destinationSymbol: string;
  maxUsd: number;
  slippageBps: number;
  excludeMints?: string[];
  includeUnpriced?: boolean;
}

export interface SplitSwapAllocation {
  mint: string;
  symbol: string;
  percent: number;
}

export interface SplitSwapPlanRequest {
  sourceToken: TokenBalance;
  sourceSymbol: string;
  amountArg: string;
  allocations: SplitSwapAllocation[];
  slippageBps: number;
}

function buildLeg(
  index: number,
  inputMint: string,
  outputMint: string,
  inputSymbol: string,
  outputSymbol: string,
  requestedInAmount: bigint,
  slippageBps: number,
): MultiSwapLeg {
  const quoteRequest: SwapQuoteRequest = {
    inputMint,
    outputMint,
    amount: requestedInAmount.toString(),
    slippageBps,
  };

  return {
    index,
    inputMint,
    outputMint,
    inputSymbol,
    outputSymbol,
    requestedInAmount: requestedInAmount.toString(),
    quoteRequest,
  };
}

function buildSkippedLeg(
  inputMint: string,
  outputMint: string,
  inputSymbol: string,
  outputSymbol: string,
  requestedInAmount: bigint,
  reason: string,
): MultiSwapSkippedLeg {
  return {
    inputMint,
    outputMint,
    inputSymbol,
    outputSymbol,
    requestedInAmount: requestedInAmount.toString(),
    reason,
  };
}

function buildPlan(
  mode: MultiSwapPlan["mode"],
  continueOnFailure: boolean,
  legs: MultiSwapLeg[],
  skipped: MultiSwapSkippedLeg[],
): MultiSwapPlan {
  return {
    mode,
    sequential: true,
    continueOnFailure,
    summary: {
      legsPlanned: legs.length,
      legsSkipped: skipped.length,
    },
    legs,
    skipped,
  };
}

function getTokenSymbol(balance: TokenBalance, metadata: Map<string, TokenMetadata>): string {
  const symbol = metadata.get(balance.mint)?.symbol;
  if (balance.assetKind === "native-sol") {
    return "SOL";
  }
  if (balance.assetKind === "wrapped-sol") {
    return symbol ?? "WSOL";
  }
  return symbol ?? balance.mint;
}

function getDustEligibleUsdValue(
  balance: TokenBalance,
  prices: Map<string, TokenPrice>,
): number | null {
  const price = prices.get(balance.mint);
  if (!price) {
    return null;
  }

  return balance.balance * price.usdPrice;
}

function getAllocationBps(percent: number): bigint {
  if (!Number.isFinite(percent) || percent <= 0) {
    throw new Error("Split allocation percentages must be greater than 0.");
  }

  return BigInt(Math.round(percent * PERCENT_SCALE));
}

function getScaledAllocationTotal(allocations: SplitSwapAllocation[]): bigint {
  return allocations.reduce((total, allocation) => total + getAllocationBps(allocation.percent), 0n);
}

function getAvailableSplitInputAmount(
  sourceToken: TokenBalance,
  amountArg: string,
  plannedLegCount: number,
): bigint {
  if (plannedLegCount <= 0) {
    throw new Error("Split swap requires at least one destination allocation.");
  }

  if (amountArg === "max") {
    if (sourceToken.isNative) {
      throw new Error("`max` is not supported for native SOL multi-leg swaps in v1.");
    }

    if (sourceToken.rawBalance <= 0n) {
      throw new Error("Insufficient balance for split swap.");
    }

    return sourceToken.rawBalance;
  }

  const amount = parseDecimalAmount(amountArg, sourceToken.decimals) ?? 0n;
  if (amount <= 0n) {
    throw new Error(`Invalid amount: ${amountArg}`);
  }

  if (!sourceToken.isNative) {
    if (amount > sourceToken.rawBalance) {
      throw new Error(
        `Insufficient balance. Have ${sourceToken.balance}, swapping ${amountArg}.`,
      );
    }
    return amount;
  }

  if (maxSendableSol(sourceToken.rawBalance) === 0n) {
    throw new Error("Insufficient SOL balance (need to reserve for fees).");
  }

  const feeBuffer = MULTI_SWAP_SOL_FEE_BUFFER_LAMPORTS_PER_LEG * BigInt(plannedLegCount);
  if (feeBuffer >= sourceToken.rawBalance) {
    throw new Error("Insufficient SOL balance after reserving fees for multi-leg swap execution.");
  }

  const maxMultiSwapAmount = sourceToken.rawBalance - feeBuffer;
  if (amount > maxMultiSwapAmount) {
    throw new Error("Insufficient SOL balance after reserving fees for multi-leg swap execution.");
  }

  return amount;
}

export function buildDustSwapPlan(request: DustSwapPlanRequest): MultiSwapPlan {
  if (!Number.isFinite(request.maxUsd) || request.maxUsd <= 0) {
    throw new Error("Dust threshold must be greater than 0.");
  }

  const excludedMints = new Set([request.destinationMint, ...(request.excludeMints ?? [])]);
  const legs: MultiSwapLeg[] = [];
  const skipped: MultiSwapSkippedLeg[] = [];

  for (const balance of request.balances) {
    const inputSymbol = getTokenSymbol(balance, request.metadata);

    if (balance.rawBalance <= 0n) {
      continue;
    }

    if (excludedMints.has(balance.mint)) {
      continue;
    }

    if (balance.isNative) {
      skipped.push(buildSkippedLeg(
        balance.mint,
        request.destinationMint,
        inputSymbol,
        request.destinationSymbol,
        balance.rawBalance,
        "Native SOL dust swaps are not supported in v1.",
      ));
      continue;
    }

    const usdValue = getDustEligibleUsdValue(balance, request.prices);
    if (usdValue === null) {
      if (request.includeUnpriced) {
        skipped.push(buildSkippedLeg(
          balance.mint,
          request.destinationMint,
          inputSymbol,
          request.destinationSymbol,
          balance.rawBalance,
          "Unpriced assets are not supported for dust planning in v1.",
        ));
      }
      continue;
    }

    if (usdValue > request.maxUsd) {
      continue;
    }

    legs.push(buildLeg(
      legs.length,
      balance.mint,
      request.destinationMint,
      inputSymbol,
      request.destinationSymbol,
      balance.rawBalance,
      request.slippageBps,
    ));
  }

  if (legs.length === 0) {
    throw new Error(`No eligible dust assets found under $${request.maxUsd.toFixed(2)}.`);
  }

  return buildPlan("dust", true, legs, skipped);
}

export function buildSplitSwapPlan(request: SplitSwapPlanRequest): MultiSwapPlan {
  if (request.allocations.length === 0) {
    throw new Error("Split swap requires at least one destination allocation.");
  }

  const scaledTotal = getScaledAllocationTotal(request.allocations);
  const expectedTotal = 100n * PERCENT_SCALE_FACTOR;
  if (scaledTotal !== expectedTotal) {
    throw new Error("Split allocations must sum to 100.");
  }

  const seenOutputMints = new Set<string>();
  for (const allocation of request.allocations) {
    if (allocation.mint === request.sourceToken.mint) {
      throw new Error("Split destination tokens must differ from the source token.");
    }
    if (seenOutputMints.has(allocation.mint)) {
      throw new Error("Split destination tokens must be unique.");
    }
    seenOutputMints.add(allocation.mint);
  }

  const totalInputAmount = getAvailableSplitInputAmount(
    request.sourceToken,
    request.amountArg,
    request.allocations.length,
  );

  const legs: MultiSwapLeg[] = [];
  let allocatedAmount = 0n;
  for (const [index, allocation] of request.allocations.entries()) {
    const requestedInAmount = index === request.allocations.length - 1
      ? totalInputAmount - allocatedAmount
      : (totalInputAmount * getAllocationBps(allocation.percent)) / expectedTotal;

    if (requestedInAmount <= 0n) {
      throw new Error("Each split allocation must result in a positive input amount.");
    }

    allocatedAmount += requestedInAmount;
    legs.push(buildLeg(
      index,
      request.sourceToken.mint,
      allocation.mint,
      request.sourceSymbol,
      allocation.symbol,
      requestedInAmount,
      request.slippageBps,
    ));
  }

  return buildPlan("split", false, legs, []);
}

export function getMultiSwapSolFeeBufferLamports(plannedLegCount: number): bigint {
  if (plannedLegCount <= 0) {
    return 0n;
  }

  return MULTI_SWAP_SOL_FEE_BUFFER_LAMPORTS_PER_LEG * BigInt(plannedLegCount);
}
