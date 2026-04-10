import { getAssetSymbol, NATIVE_SOL_MINT, parseDecimalAmount } from "../lib/format.js";
import { fetchAllBalances } from "../portfolio/index.js";
import { fetchTokenMetadata } from "../pricing/index.js";
import { executeTransfer, isValidSolanaAddress, maxSendableSol } from "../transfer/index.js";
import type { TokenBalance, TokenMetadata } from "../types/portfolio.js";
import type { TransferRequest } from "../types/transfer.js";
import { bootstrap, getCliActiveSigner, printJson } from "./index.js";

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

function resolveSendToken(
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
      throw new Error('Token is ambiguous. Use `SOL` for native SOL or `WSOL` for wrapped SOL.');
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
    throw new Error(`Token "${selector}" not found in wallet.`);
  }
  if (symbolMatches.length > 1) {
    throw new Error(`Token "${selector}" is ambiguous. Use the mint or token account address instead.`);
  }

  return symbolMatches[0];
}

export async function sendCommand(args: string[], json: boolean): Promise<void> {
  if (args.length < 3) {
    throw new Error(
      "Usage: wui send <address> <amount> <token>\n" +
      "  address  Recipient Solana address\n" +
      "  amount   Amount to send (or \"max\")\n" +
      "  token    Token symbol (e.g. SOL, USDC) or mint address",
    );
  }

  const [recipientArg, amountArg, tokenArg] = args;

  if (!isValidSolanaAddress(recipientArg)) {
    throw new Error(`Invalid recipient address: ${recipientArg}`);
  }

  const { config, rpc, wallet } = await bootstrap();

  if (recipientArg === wallet.publicKey) {
    throw new Error("Cannot send to yourself.");
  }

  const signer = await getCliActiveSigner(json);

  // Find the token in the wallet's balances.
  const balances = await fetchAllBalances(rpc, wallet.publicKey);
  const mints = balances.map((b) => b.mint);
  const metadata = await fetchTokenMetadata(mints, config.jupiterApiKey);

  const token = resolveSendToken(balances, metadata, tokenArg);

  // Parse amount.
  let rawAmount: bigint;
  let displayAmount: string;
  if (amountArg === "max") {
    if (token.isNative) {
      rawAmount = maxSendableSol(token.rawBalance);
      if (rawAmount === 0n) {
        throw new Error("Insufficient SOL balance (need to reserve for fees).");
      }
      displayAmount = (Number(rawAmount) / 10 ** token.decimals).toLocaleString("en-US", {
        maximumFractionDigits: 6,
      });
    } else {
      rawAmount = token.rawBalance;
      displayAmount = token.balance.toLocaleString("en-US", { maximumFractionDigits: 6 });
    }
  } else {
    rawAmount = parseDecimalAmount(amountArg, token.decimals) ?? 0n;
    if (rawAmount <= 0n) {
      throw new Error(`Invalid amount: ${amountArg}`);
    }
    if (rawAmount > token.rawBalance) {
      throw new Error(
        `Insufficient balance. Have ${token.balance}, sending ${amountArg}.`,
      );
    }
    displayAmount = amountArg;
  }

  const request: TransferRequest = {
    mint: token.mint,
    sourceAccountAddress: token.accountAddress,
    recipient: recipientArg,
    amount: rawAmount,
    decimals: token.decimals,
    isNative: token.isNative,
  };

  const symbol = metadata.get(token.mint)?.symbol ?? token.mint.slice(0, 8);

  if (!json) {
    console.log(`Sending ${displayAmount} ${symbol} to ${recipientArg}...`);
  }

  const result = await executeTransfer(request, signer, rpc, json ? undefined : (s) => console.log(s));

  if (json) {
    printJson({
      success: result.success,
      signature: result.signature,
      mint: result.mint,
      recipient: result.recipient,
      amount: result.amount,
      decimals: result.decimals,
      error: result.error,
    });
  } else if (result.success) {
    console.log(`Transfer successful! Tx: ${result.signature}`);
  } else {
    throw new Error(result.error ?? "Transfer failed.");
  }
}
