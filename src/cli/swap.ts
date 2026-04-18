import {
  DEFAULT_SLIPPAGE_PCT,
  buildDustSwapPlan,
  buildSplitSwapPlan,
  executeMultiSwapPlan,
  executeSwap,
  getSwapQuote,
  previewDustSwapPlan,
  previewStrictMultiSwapPlan,
} from "../swap/index.js";
import { formatAmount, formatUsd, truncateAddress } from "../lib/format.js";
import {
  resolveDestinationToken,
  resolveSwapSourceToken,
  tokenSymbol,
  validateSwapAmount,
} from "../lib/token-selectors.js";
import { fetchAllBalances } from "../portfolio/index.js";
import { fetchTokenMetadata, fetchTokenPrices } from "../pricing/index.js";
import type { TokenBalance, TokenMetadata } from "../types/portfolio.js";
import type { MultiSwapPreviewResult, SwapQuote, SwapQuoteRequest } from "../types/swap.js";
import { bootstrap, getCliActiveSigner, printJson } from "./index.js";

export const SWAP_USAGE = `Usage: wui swap <amount> <from> <to>
       wui swap dust <to> --max-usd <amount> [options]
       wui swap split <amount> <from> <pct:token,pct:token,...>

Swap an exact input amount from one token into another.

Examples:
  wui swap max SOL USDC
  wui swap 0.1 SOL JitoSOL
  wui swap 10 USDC SOL
  wui swap 0.1 So11111111111111111111111111111111111111112 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  wui swap dust SOL --max-usd 5
  wui swap dust USDC --max-usd 3 --exclude USDT,JitoSOL
  wui swap split 1 SOL 50:JitoSOL,30:mSOL,20:JupSOL
  wui swap split max USDC 70:SOL,30:JitoSOL`;

interface DustSwapArgs {
  destinationSelector: string;
  maxUsd: number;
  excludeSelectors: string[];
  includeUnpriced: boolean;
}

interface SplitSwapArgs {
  amountArg: string;
  sourceSelector: string;
  allocations: Array<{
    percent: number;
    destinationSelector: string;
  }>;
}

interface ResolvedSplitAllocation {
  percent: number;
  mint: string;
  symbol: string;
  decimals: number | null;
}

function getSlippageBps(): number {
  const slippagePct = parseFloat(DEFAULT_SLIPPAGE_PCT);
  return Math.round(slippagePct * 10) * 10;
}

function buildSwapJsonResult(
  result: Awaited<ReturnType<typeof executeSwap>>,
  sourceSymbol: string,
  destinationSymbol: string,
) {
  return {
    ...result,
    inputSymbol: sourceSymbol,
    outputSymbol: destinationSymbol,
  };
}

function getTokenDecimals(
  balance: TokenBalance,
  metadata: Map<string, TokenMetadata>,
): number {
  return metadata.get(balance.mint)?.decimals ?? balance.decimals;
}

function parseOptionValue(arg: string, flag: string): string | null {
  if (arg === flag) {
    return "";
  }
  if (arg.startsWith(`${flag}=`)) {
    return arg.slice(flag.length + 1);
  }
  return null;
}

function parseDustSwapArgs(args: string[]): DustSwapArgs {
  if (args.length === 0) {
    throw new Error(SWAP_USAGE);
  }

  const destinationSelector = args[0];
  let maxUsd: number | null = null;
  const excludeSelectors: string[] = [];
  let includeUnpriced = false;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];

    const maxUsdValue = parseOptionValue(arg, "--max-usd");
    if (maxUsdValue !== null) {
      const rawValue = maxUsdValue === "" ? args[index + 1] : maxUsdValue;
      if (!rawValue) {
        throw new Error("Missing value for `--max-usd`.");
      }
      if (maxUsdValue === "") {
        index += 1;
      }
      maxUsd = Number(rawValue);
      continue;
    }

    const excludeValue = parseOptionValue(arg, "--exclude");
    if (excludeValue !== null) {
      const rawValue = excludeValue === "" ? args[index + 1] : excludeValue;
      if (!rawValue) {
        throw new Error("Missing value for `--exclude`.");
      }
      if (excludeValue === "") {
        index += 1;
      }
      excludeSelectors.push(...rawValue.split(",").map((value) => value.trim()).filter(Boolean));
      continue;
    }

    if (arg === "--include-unpriced") {
      includeUnpriced = true;
      continue;
    }

    if (arg === "--include-sol") {
      throw new Error("`--include-sol` is not supported for dust swaps in v1.");
    }

    throw new Error(`Unknown swap dust option: ${arg}`);
  }

  if (maxUsd === null || !Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new Error("Dust swap requires `--max-usd <amount>` with a value greater than 0.");
  }

  return {
    destinationSelector,
    maxUsd,
    excludeSelectors,
    includeUnpriced,
  };
}

function parseSplitAllocation(rawValue: string): Array<{ percent: number; destinationSelector: string }> {
  const entries = rawValue.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    throw new Error("Split swap requires at least one allocation.");
  }

  return entries.map((entry) => {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error(`Invalid split allocation: ${entry}`);
    }

    const percent = Number(entry.slice(0, separatorIndex));
    const destinationSelector = entry.slice(separatorIndex + 1).trim();
    if (!Number.isFinite(percent) || percent <= 0) {
      throw new Error(`Invalid split allocation percentage: ${entry}`);
    }
    if (destinationSelector.length === 0) {
      throw new Error(`Invalid split allocation destination: ${entry}`);
    }

    return {
      percent,
      destinationSelector,
    };
  });
}

function parseSplitSwapArgs(args: string[]): SplitSwapArgs {
  if (args.length < 3) {
    throw new Error(SWAP_USAGE);
  }

  const [amountArg, sourceSelector, allocationsArg, ...rest] = args;
  if (rest.length > 0) {
    throw new Error(`Unknown swap split option: ${rest[0]}`);
  }

  const allocations = parseSplitAllocation(allocationsArg);

  return {
    amountArg,
    sourceSelector,
    allocations,
  };
}

function printDustPreview(
  maxUsd: number,
  preview: MultiSwapPreviewResult,
  inputDecimals: Map<string, number>,
  outputDecimals: number,
): void {
  console.log(`Dust swap plan -> ${preview.executionPlan.legs[0]?.outputSymbol ?? "destination"}`);
  console.log(`Threshold: ${formatUsd(maxUsd)}`);
  console.log(`Planned:   ${preview.executionPlan.summary.legsPlanned} swap(s)`);
  if (preview.executionPlan.summary.legsSkipped > 0) {
    console.log(`Skipped:   ${preview.executionPlan.summary.legsSkipped} asset(s)`);
  }
  console.log();

  for (const { leg, quote } of preview.previewLegs) {
    const decimals = inputDecimals.get(leg.inputMint) ?? 0;
    console.log(
      `${leg.index + 1}. ${formatAmount(leg.requestedInAmount, decimals)} ${leg.inputSymbol}`
      + ` -> ${formatAmount(quote.outAmount, outputDecimals)} ${leg.outputSymbol}`,
    );
  }

  if (preview.executionPlan.skipped.length > 0) {
    console.log();
    console.log("Skipped:");
    for (const skipped of preview.executionPlan.skipped) {
      console.log(`- ${skipped.inputSymbol}: ${skipped.reason}`);
    }
  }

  console.log();
  console.log("This plan executes as separate swap transactions. Earlier legs may succeed even if a later leg fails.");
  console.log();
}

function printSplitPreview(
  sourceSymbol: string,
  preview: MultiSwapPreviewResult,
  inputDecimals: number,
  outputDecimals: Map<string, number>,
): void {
  const totalRequestedInAmount = preview.previewLegs.reduce(
    (sum, item) => sum + BigInt(item.leg.requestedInAmount),
    0n,
  );

  console.log(`Split swap plan from ${sourceSymbol}`);
  console.log(`Planned: ${preview.executionPlan.summary.legsPlanned} swap(s)`);
  console.log();

  for (const { leg, quote } of preview.previewLegs) {
    const decimals = outputDecimals.get(leg.outputMint) ?? 6;
    const percentBps = totalRequestedInAmount === 0n
      ? 0n
      : (BigInt(leg.requestedInAmount) * 10_000n) / totalRequestedInAmount;
    const percent = `${Number(percentBps) / 100}`;
    console.log(
      `${leg.index + 1}. ${formatAmount(quote.inAmount, inputDecimals)} ${sourceSymbol}`
      + ` -> ${formatAmount(quote.outAmount, decimals)} ${leg.outputSymbol}`
      + ` (${percent}%)`,
    );
  }

  console.log();
  console.log("This plan executes as separate swap transactions and stops on the first failed leg.");
  console.log();
}

function buildDustJsonResult(
  destinationMint: string,
  destinationSymbol: string,
  maxUsd: number,
  preview: MultiSwapPreviewResult,
  execution: Awaited<ReturnType<typeof executeMultiSwapPlan>>,
) {
  return {
    mode: "dust",
    destinationMint,
    destinationSymbol,
    maxUsd,
    sequential: true,
    preview: {
      summary: preview.executionPlan.summary,
      skipped: preview.executionPlan.skipped,
      legs: preview.previewLegs.map(({ leg, quote }) => ({
        index: leg.index,
        inputMint: leg.inputMint,
        outputMint: leg.outputMint,
        inputSymbol: leg.inputSymbol,
        outputSymbol: leg.outputSymbol,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
      })),
    },
    execution,
  };
}

function buildSplitJsonResult(
  amountArg: string,
  sourceMint: string,
  sourceSymbol: string,
  preview: MultiSwapPreviewResult,
  execution: Awaited<ReturnType<typeof executeMultiSwapPlan>>,
) {
  return {
    mode: "split",
    amount: amountArg,
    sourceMint,
    sourceSymbol,
    sequential: true,
    preview: {
      summary: preview.executionPlan.summary,
      legs: preview.previewLegs.map(({ leg, quote }) => ({
        index: leg.index,
        inputMint: leg.inputMint,
        outputMint: leg.outputMint,
        inputSymbol: leg.inputSymbol,
        outputSymbol: leg.outputSymbol,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
      })),
    },
    execution,
  };
}

async function dustSwapCommand(args: string[], json: boolean): Promise<void> {
  const dustArgs = parseDustSwapArgs(args);
  const { config, rpc, wallet } = await bootstrap();

  const balances = await fetchAllBalances(rpc, wallet.publicKey);
  const mints = [...new Set(balances.map((balance) => balance.mint))];
  const [metadata, prices] = await Promise.all([
    fetchTokenMetadata(mints, config.jupiterApiKey),
    fetchTokenPrices(mints, config.jupiterApiKey),
  ]);

  const destinationToken = await resolveDestinationToken(dustArgs.destinationSelector, config.jupiterApiKey);
  const excludeMints: string[] = [];
  for (const selector of dustArgs.excludeSelectors) {
    const excludedToken = await resolveDestinationToken(selector, config.jupiterApiKey);
    excludeMints.push(excludedToken.mint);
  }

  const plan = buildDustSwapPlan({
    balances,
    metadata,
    prices,
    destinationMint: destinationToken.mint,
    destinationSymbol: destinationToken.symbol,
    maxUsd: dustArgs.maxUsd,
    slippageBps: getSlippageBps(),
    excludeMints,
    includeUnpriced: dustArgs.includeUnpriced,
  });

  const preview = await previewDustSwapPlan(plan, config.jupiterApiKey);
  const inputDecimals = new Map(
    balances.map((balance) => [balance.mint, getTokenDecimals(balance, metadata)]),
  );
  const outputDecimals = destinationToken.decimals ?? metadata.get(destinationToken.mint)?.decimals ?? 6;

  if (!json) {
    printDustPreview(dustArgs.maxUsd, preview, inputDecimals, outputDecimals);
    console.log(`Executing ${preview.executionPlan.summary.legsPlanned} dust swap(s)...`);
  }

  const signer = await getCliActiveSigner(json);
  const execution = await executeMultiSwapPlan(
    preview.executionPlan,
    signer,
    rpc,
    config.jupiterApiKey,
    json ? undefined : (status) => console.log(status),
  );

  if (json) {
    printJson(buildDustJsonResult(
      destinationToken.mint,
      destinationToken.symbol,
      dustArgs.maxUsd,
      preview,
      execution,
    ));
    return;
  }

  console.log();
  console.log(
    `Dust swap complete: ${execution.summary.legsSucceeded} succeeded, ${execution.summary.legsFailed} failed, ${execution.summary.legsSkipped} skipped.`,
  );

  for (const legResult of execution.legs) {
    if (legResult.result.success) {
      console.log(`- ${legResult.leg.inputSymbol}: ${legResult.result.signature}`);
    } else {
      console.log(`- ${legResult.leg.inputSymbol}: ${legResult.result.error}`);
    }
  }

  if (execution.summary.legsSucceeded === 0) {
    throw new Error("All dust swap legs failed.");
  }
}

async function splitSwapCommand(args: string[], json: boolean): Promise<void> {
  const splitArgs = parseSplitSwapArgs(args);
  const { config, rpc, wallet } = await bootstrap();

  const balances = await fetchAllBalances(rpc, wallet.publicKey);
  const metadata = await fetchTokenMetadata([...new Set(balances.map((balance) => balance.mint))], config.jupiterApiKey);

  const sourceToken = resolveSwapSourceToken(balances, metadata, splitArgs.sourceSelector);
  const sourceSymbol = tokenSymbol(sourceToken, metadata);

  const resolvedAllocations: ResolvedSplitAllocation[] = [];
  for (const allocation of splitArgs.allocations) {
    const token = await resolveDestinationToken(allocation.destinationSelector, config.jupiterApiKey);
    resolvedAllocations.push({
      percent: allocation.percent,
      mint: token.mint,
      symbol: token.symbol,
      decimals: token.decimals,
    });
  }

  const plan = buildSplitSwapPlan({
    sourceToken,
    sourceSymbol,
    amountArg: splitArgs.amountArg,
    allocations: resolvedAllocations,
    slippageBps: getSlippageBps(),
  });

  const preview = await previewStrictMultiSwapPlan(plan, config.jupiterApiKey);
  const outputDecimals = new Map(
    resolvedAllocations.map((allocation) => [allocation.mint, allocation.decimals ?? 6]),
  );

  if (!json) {
    printSplitPreview(sourceSymbol, preview, sourceToken.decimals, outputDecimals);
    console.log(`Executing ${preview.executionPlan.summary.legsPlanned} split swap(s)...`);
  }

  const signer = await getCliActiveSigner(json);
  const execution = await executeMultiSwapPlan(
    preview.executionPlan,
    signer,
    rpc,
    config.jupiterApiKey,
    json ? undefined : (status) => console.log(status),
  );

  if (json) {
    printJson(buildSplitJsonResult(
      splitArgs.amountArg,
      sourceToken.mint,
      sourceSymbol,
      preview,
      execution,
    ));
    return;
  }

  console.log();
  console.log(
    `Split swap complete: ${execution.summary.legsSucceeded} succeeded, ${execution.summary.legsFailed} failed, ${execution.summary.legsUnattempted} unattempted.`,
  );

  for (const legResult of execution.legs) {
    if (legResult.result.success) {
      console.log(`- ${legResult.leg.outputSymbol}: ${legResult.result.signature}`);
    } else {
      console.log(`- ${legResult.leg.outputSymbol}: ${legResult.result.error}`);
    }
  }

  for (const legResult of execution.unattempted) {
    console.log(`- ${legResult.leg.outputSymbol}: ${legResult.reason}`);
  }

  if (execution.summary.legsFailed > 0) {
    throw new Error("Split swap did not complete fully.");
  }
}

async function singleSwapCommand(args: string[], json: boolean): Promise<void> {
  if (args.length < 3) {
    throw new Error(SWAP_USAGE);
  }

  const [amountArg, fromArg, toArg] = args;
  const { config, rpc, wallet } = await bootstrap();

  const balances = await fetchAllBalances(rpc, wallet.publicKey);
  const metadata = await fetchTokenMetadata([...new Set(balances.map((balance) => balance.mint))], config.jupiterApiKey);

  const sourceToken = resolveSwapSourceToken(balances, metadata, fromArg);
  const destinationToken = await resolveDestinationToken(toArg, config.jupiterApiKey);

  if (sourceToken.mint === destinationToken.mint) {
    throw new Error("Input and output tokens must be different.");
  }

  const amount = validateSwapAmount(sourceToken, amountArg);
  const quoteRequest: SwapQuoteRequest = {
    inputMint: sourceToken.mint,
    outputMint: destinationToken.mint,
    amount: String(amount),
    slippageBps: getSlippageBps(),
  };

  const sourceSymbol = tokenSymbol(sourceToken, metadata);
  const destinationSymbol = destinationToken.symbol || truncateAddress(destinationToken.mint);

  if (!json) {
    console.log(`Swapping ${amountArg} ${sourceSymbol} for ${destinationSymbol}...`);
  }

  const quote: SwapQuote = await getSwapQuote(quoteRequest, config.jupiterApiKey);
  const signer = await getCliActiveSigner(json);
  const result = await executeSwap(quote, signer, rpc, config.jupiterApiKey, json ? undefined : (status) => console.log(status));

  if (json) {
    printJson(buildSwapJsonResult(result, sourceSymbol, destinationSymbol));
    return;
  }

  if (!result.success) {
    throw new Error(result.error ?? "Swap failed.");
  }

  console.log(`Swap successful! Tx: ${result.signature}`);
}

export async function swapCommand(args: string[], json: boolean): Promise<void> {
  if (args[0] === "dust") {
    await dustSwapCommand(args.slice(1), json);
    return;
  }

  if (args[0] === "split") {
    await splitSwapCommand(args.slice(1), json);
    return;
  }

  await singleSwapCommand(args, json);
}
