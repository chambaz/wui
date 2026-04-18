import { getAssetSymbol, NATIVE_SOL_MINT, parseDecimalAmount, truncateAddress } from "../lib/format.js";
import { fetchTokenMetadata, searchTokens } from "../pricing/index.js";
import { isValidSolanaAddress, maxSendableSol } from "../transfer/index.js";
import type { TokenBalance, TokenMetadata } from "../types/portfolio.js";

export interface ResolvedDestinationToken {
  mint: string;
  symbol: string;
}

export function normalizeTokenInput(value: string): string {
  return value.trim().toUpperCase();
}

export function tokenSymbol(
  balance: TokenBalance,
  metadata: Map<string, TokenMetadata>,
): string {
  return getAssetSymbol(
    balance.assetKind,
    balance.mint,
    metadata.get(balance.mint)?.symbol ?? null,
  );
}

export function resolveSwapSourceToken(
  balances: TokenBalance[],
  metadata: Map<string, TokenMetadata>,
  selector: string,
): TokenBalance {
  const normalizedSelector = normalizeTokenInput(selector);

  const assetKindMatches = balances.filter((balance) => {
    if (normalizedSelector === "SOL") {
      return balance.assetKind === "native-sol";
    }

    if (
      normalizedSelector === "WSOL"
      || normalizedSelector === "WRAPPED SOL"
      || normalizedSelector === "WRAPPED-SOL"
    ) {
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

export async function resolveDestinationToken(
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

export function validateSwapAmount(sourceToken: TokenBalance, amountArg: string): bigint {
  if (amountArg === "max") {
    if (sourceToken.isNative) {
      const max = maxSendableSol(sourceToken.rawBalance);
      if (max === 0n) {
        throw new Error("Insufficient SOL balance (need to reserve for fees).");
      }
      return max;
    }

    if (sourceToken.rawBalance <= 0n) {
      throw new Error(`Insufficient balance. Have ${sourceToken.balance}, swapping ${amountArg}.`);
    }

    return sourceToken.rawBalance;
  }

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
