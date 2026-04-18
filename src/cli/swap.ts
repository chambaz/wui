import {
  DEFAULT_SLIPPAGE_PCT,
  buildDustSwapPlan,
  executeMultiSwapPlan,
  executeSwap,
  getSwapQuote,
} from "../swap/index.js";
import { formatAmount, formatUsd, truncateAddress } from "../lib/format.js";
import { fetchAllBalances } from "../portfolio/index.js";
import { fetchTokenMetadata, fetchTokenPrices } from "../pricing/index.js";
import type { TokenBalance, TokenMetadata } from "../types/portfolio.js";
import type { MultiSwapLeg, MultiSwapPlan, SwapQuote, SwapQuoteRequest } from "../types/swap.js";
import { bootstrap, getCliActiveSigner, printJson } from "./index.js";
import {
  resolveDestinationToken,
  resolveSwapSourceToken,
  tokenSymbol,
  validateSwapAmount,
} from "./swap-helpers.js";

export const SWAP_USAGE = `Usage: wui swap <amount> <from> <to>
       wui swap dust <to> --max-usd <amount> [options]

Swap an exact input amount from one token into another.

Examples:
  wui swap max SOL USDC
  wui swap 0.1 SOL JitoSOL
  wui swap 10 USDC SOL
  wui swap 0.1 So11111111111111111111111111111111111111112 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  wui swap dust SOL --max-usd 5
  wui swap dust USDC --max-usd 3 --exclude USDT,JitoSOL`;

interface DustSwapArgs {
  destinationSelector: string;
  maxUsd: number;
  excludeSelectors: string[];
  includeUnpriced: boolean;
  includeSol: boolean;
}

interface QuotedDustLeg {
  leg: MultiSwapLeg;
  quote: SwapQuote;
}

interface DustPreviewResult {
  executionPlan: MultiSwapPlan;
  previewLegs: QuotedDustLeg[];
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
  let includeSol = false;

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
      includeSol = true;
      continue;
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
    includeSol,
  };
}

async function previewDustPlan(
  plan: MultiSwapPlan,
  apiKey: string,
): Promise<DustPreviewResult> {
  const previewLegs: QuotedDustLeg[] = [];
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

function printDustPreview(
  maxUsd: number,
  preview: DustPreviewResult,
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

function buildDustJsonResult(
  destinationMint: string,
  destinationSymbol: string,
  maxUsd: number,
  preview: DustPreviewResult,
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
    includeSol: dustArgs.includeSol,
  });

  const preview = await previewDustPlan(plan, config.jupiterApiKey);
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

  await singleSwapCommand(args, json);
}
