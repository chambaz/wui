import { DEFAULT_SLIPPAGE_PCT, executeSwap, getSwapQuote } from "../swap/index.js";
import { isValidSolanaAddress, maxSendableSol } from "../transfer/index.js";
import { getAssetSymbol, NATIVE_SOL_MINT, parseDecimalAmount, truncateAddress } from "../lib/format.js";
import { fetchAllBalances } from "../portfolio/index.js";
import { fetchTokenMetadata, searchTokens } from "../pricing/index.js";
import type { TokenBalance, TokenMetadata } from "../types/portfolio.js";
import type { SwapQuote, SwapQuoteRequest } from "../types/swap.js";
import { bootstrap, getCliActiveSigner, printJson } from "./index.js";

export const SWAP_USAGE = `Usage: wui swap <amount> <from> <to>

Swap an exact input amount from one token into another.

Examples:
  wui swap 0.1 SOL JitoSOL
  wui swap 10 USDC SOL
  wui swap 0.1 So11111111111111111111111111111111111111112 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`;

interface ResolvedDestinationToken {
  mint: string;
  symbol: string;
}

function normalizeTokenInput(value: string): string {
  return value.trim().toUpperCase();
}

function tokenSymbol(balance: TokenBalance, metadata: Map<string, TokenMetadata>): string {
  return getAssetSymbol(
    balance.assetKind,
    balance.mint,
    metadata.get(balance.mint)?.symbol ?? null,
  );
}

function resolveSourceToken(
  balances: TokenBalance[],
  metadata: Map<string, TokenMetadata>,
  selector: string,
): TokenBalance {
  const normalizedSelector = normalizeTokenInput(selector);

  const assetKindMatches = balances.filter((balance) => {
    if (normalizedSelector === "SOL") {
      return balance.assetKind === "native-sol";
    }

    if (normalizedSelector === "WSOL" || normalizedSelector === "WRAPPED SOL" || normalizedSelector === "WRAPPED-SOL") {
      return balance.assetKind === "wrapped-sol";
    }

    return false;
  });
  if (assetKindMatches.length === 1) {
    return assetKindMatches[0];
  }

  const accountMatches = balances.filter((balance) => balance.accountAddress === selector);
  if (accountMatches.length === 1) {
    return accountMatches[0];
  }

  const mintMatches = balances.filter((balance) => balance.mint === selector);
  if (mintMatches.length === 1) {
    return mintMatches[0];
  }
  if (mintMatches.length > 1) {
    if (selector === NATIVE_SOL_MINT) {
      throw new Error("Source token is ambiguous. Use `SOL` for native SOL or `WSOL` for wrapped SOL.");
    }

    throw new Error(`Token "${selector}" is ambiguous in your wallet. Use the token account address instead.`);
  }

  const symbolMatches = balances.filter((balance) => {
    const symbol = tokenSymbol(balance, metadata);
    const metaSymbol = metadata.get(balance.mint)?.symbol ?? null;
    return normalizeTokenInput(symbol) === normalizedSelector
      || (metaSymbol !== null && normalizeTokenInput(metaSymbol) === normalizedSelector);
  });

  if (symbolMatches.length === 0) {
    throw new Error(`Source token "${selector}" not found in wallet.`);
  }
  if (symbolMatches.length > 1) {
    throw new Error(`Source token "${selector}" is ambiguous. Use the mint or token account address instead.`);
  }

  return symbolMatches[0];
}

async function resolveDestinationToken(
  selector: string,
  apiKey: string,
): Promise<ResolvedDestinationToken> {
  if (isValidSolanaAddress(selector)) {
    const metadata = await fetchTokenMetadata([selector], apiKey);
    const token = metadata.get(selector);
    return {
      mint: selector,
      symbol: token?.symbol ?? truncateAddress(selector),
    };
  }

  const searchResults = await searchTokens(selector, apiKey);

  const mintMatches = searchResults.filter((token) => token.mint === selector);
  if (mintMatches.length === 1) {
    return { mint: mintMatches[0].mint, symbol: mintMatches[0].symbol };
  }
  if (mintMatches.length > 1) {
    throw new Error(`Destination token "${selector}" is ambiguous. Use the mint address instead.`);
  }

  const normalizedSelector = normalizeTokenInput(selector);
  const exactMatches = searchResults.filter((token) => {
    return normalizeTokenInput(token.symbol) === normalizedSelector
      || normalizeTokenInput(token.name) === normalizedSelector;
  });

  if (exactMatches.length > 0) {
    return { mint: exactMatches[0].mint, symbol: exactMatches[0].symbol };
  }

  if (searchResults.length === 0) {
    throw new Error(`Destination token "${selector}" not found.`);
  }

  return { mint: searchResults[0].mint, symbol: searchResults[0].symbol };
}

function validateSwapAmount(sourceToken: TokenBalance, amountArg: string): bigint {
  const amount = parseDecimalAmount(amountArg, sourceToken.decimals) ?? 0n;
  if (amount <= 0n) {
    throw new Error(`Invalid amount: ${amountArg}`);
  }

  if (sourceToken.isNative) {
    const max = maxSendableSol(sourceToken.rawBalance);
    if (amount > max) {
      throw new Error("Insufficient SOL balance (need to reserve for fees).");
    }
    return amount;
  }

  if (amount > sourceToken.rawBalance) {
    throw new Error(
      `Insufficient balance. Have ${sourceToken.balance}, swapping ${amountArg}.`,
    );
  }

  return amount;
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

export async function swapCommand(args: string[], json: boolean): Promise<void> {
  if (args.length < 3) {
    throw new Error(SWAP_USAGE);
  }

  const [amountArg, fromArg, toArg] = args;
  const { config, rpc, wallet } = await bootstrap();

  const balances = await fetchAllBalances(rpc, wallet.publicKey);
  const metadata = await fetchTokenMetadata([...new Set(balances.map((balance) => balance.mint))], config.jupiterApiKey);

  const sourceToken = resolveSourceToken(balances, metadata, fromArg);
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
