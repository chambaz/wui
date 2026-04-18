import { DEFAULT_SLIPPAGE_PCT, executeSwap, getSwapQuote } from "../swap/index.js";
import { truncateAddress } from "../lib/format.js";
import { fetchAllBalances } from "../portfolio/index.js";
import { fetchTokenMetadata } from "../pricing/index.js";
import type { SwapQuote, SwapQuoteRequest } from "../types/swap.js";
import { bootstrap, getCliActiveSigner, printJson } from "./index.js";
import {
  resolveDestinationToken,
  resolveSwapSourceToken,
  tokenSymbol,
  validateSwapAmount,
} from "./swap-helpers.js";

export const SWAP_USAGE = `Usage: wui swap <amount> <from> <to>

Swap an exact input amount from one token into another.

Examples:
  wui swap max SOL USDC
  wui swap 0.1 SOL JitoSOL
  wui swap 10 USDC SOL
  wui swap 0.1 So11111111111111111111111111111111111111112 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`;

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

export async function swapCommand(args: string[], json: boolean): Promise<void> {
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
