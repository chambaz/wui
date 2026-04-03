import { parseDecimalAmount } from "../lib/format.js";
import { fetchAllBalances } from "../portfolio/index.js";
import { fetchTokenMetadata } from "../pricing/index.js";
import {
  getActiveWalletProvider,
  unlockWallet,
  WalletLockedError,
} from "../wallet/index.js";
import { executeTransfer, isValidSolanaAddress, maxSendableSol } from "../transfer/index.js";
import type { TransferRequest } from "../types/transfer.js";
import { bootstrap, printJson } from "./index.js";
import { promptForPassphrase } from "./prompt.js";

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

  let provider;
  try {
    provider = await getActiveWalletProvider();
  } catch (error: unknown) {
    if (error instanceof WalletLockedError) {
      if (json) {
        throw new Error(
          "Encrypted wallets are not supported with `wui send --json` because passphrase entry requires an interactive terminal.",
        );
      }
      const passphrase = await promptForPassphrase(`Enter passphrase to unlock wallet "${wallet.label}": `);
      await unlockWallet(wallet.id, passphrase);
      provider = await getActiveWalletProvider();
    } else {
      throw error;
    }
  }

  if (!provider) {
    throw new Error("Could not load wallet provider.");
  }

  // Find the token in the wallet's balances.
  const balances = await fetchAllBalances(rpc, wallet.publicKey);
  const mints = balances.map((b) => b.mint);
  const metadata = await fetchTokenMetadata(mints, config.jupiterApiKey);

  // Match by symbol (case-insensitive) or by mint address.
  const tokenUpper = tokenArg.toUpperCase();
  const token = balances.find((b) => {
    const meta = metadata.get(b.mint);
    if (meta && meta.symbol.toUpperCase() === tokenUpper) return true;
    return b.mint === tokenArg;
  });

  if (!token) {
    throw new Error(`Token "${tokenArg}" not found in wallet.`);
  }

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
    recipient: recipientArg,
    amount: rawAmount,
    decimals: token.decimals,
    isNative: token.isNative,
  };

  const symbol = metadata.get(token.mint)?.symbol ?? token.mint.slice(0, 8);

  if (!json) {
    console.log(`Sending ${displayAmount} ${symbol} to ${recipientArg}...`);
  }

  const result = await executeTransfer(request, provider, rpc, json ? undefined : (s) => console.log(s));

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
