import { NATIVE_SOL_MINT, formatCompact } from "../lib/format.js";
import { getTokenMetadata } from "../pricing/index.js";
import type { ActivityType } from "../types/activity.js";
import type { ParsedTransaction, TokenBalanceEntry, ClassifiedTx } from "./types.js";

export const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

function mintSymbol(mint: string): string {
  const meta = getTokenMetadata(mint);
  if (meta) return meta.symbol;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function computeTokenChanges(
  pre: TokenBalanceEntry[],
  post: TokenBalanceEntry[],
  owner: string,
): Array<{ mint: string; delta: number }> {
  const preMap = new Map<string, number>();
  for (const b of pre) {
    if (b.owner === owner) {
      preMap.set(b.mint, (preMap.get(b.mint) ?? 0) + Number(b.uiTokenAmount.uiAmount ?? 0));
    }
  }

  const postMap = new Map<string, number>();
  for (const b of post) {
    if (b.owner === owner) {
      postMap.set(b.mint, (postMap.get(b.mint) ?? 0) + Number(b.uiTokenAmount.uiAmount ?? 0));
    }
  }

  const allMints = new Set([...preMap.keys(), ...postMap.keys()]);
  const changes: Array<{ mint: string; delta: number }> = [];
  for (const mint of allMints) {
    const preBal = preMap.get(mint) ?? 0;
    const postBal = postMap.get(mint) ?? 0;
    const delta = postBal - preBal;
    if (Math.abs(delta) > 1e-9) changes.push({ mint, delta });
  }
  return changes;
}

function buildSwapSummary(tx: ParsedTransaction, walletAddress: string): string {
  if (!tx.meta) return "Swap";
  const tokenChanges = computeTokenChanges(
    tx.meta.preTokenBalances,
    tx.meta.postTokenBalances,
    walletAddress,
  ).filter((c) => c.mint !== NATIVE_SOL_MINT);

  const walletIndex = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey === walletAddress);
  const solDiff = walletIndex >= 0
    ? Number(BigInt(tx.meta.postBalances[walletIndex] ?? 0) - BigInt(tx.meta.preBalances[walletIndex] ?? 0)) / 1e9
    : 0;

  const allChanges: Array<{ label: string; delta: number }> = [];
  if (Math.abs(solDiff) > 0.001) allChanges.push({ label: "SOL", delta: solDiff });
  for (const c of tokenChanges) allChanges.push({ label: mintSymbol(c.mint), delta: c.delta });

  const sold = allChanges.find((c) => c.delta < 0);
  const bought = allChanges.find((c) => c.delta > 0);
  if (sold && bought) {
    return `${formatCompact(Math.abs(sold.delta))} ${sold.label} → ${formatCompact(bought.delta)} ${bought.label}`;
  }
  return "Swap";
}

function detectTransfer(tx: ParsedTransaction, walletAddress: string): ClassifiedTx | null {
  if (!tx.meta) return null;
  const accountKeys = tx.transaction.message.accountKeys;
  const walletIndex = accountKeys.findIndex((k) => k.pubkey === walletAddress);

  const tokenChanges = computeTokenChanges(
    tx.meta.preTokenBalances,
    tx.meta.postTokenBalances,
    walletAddress,
  );

  if (tokenChanges.length === 1) {
    const c = tokenChanges[0];
    const amt = formatCompact(Math.abs(c.delta));
    const symbol = mintSymbol(c.mint);
    if (c.delta > 0) return { type: "transfer-in", summary: `Received ${amt} ${symbol}` };
    return { type: "transfer-out", summary: `Sent ${amt} ${symbol}` };
  }

  if (walletIndex >= 0) {
    const preSol = BigInt(tx.meta.preBalances[walletIndex] ?? 0);
    const postSol = BigInt(tx.meta.postBalances[walletIndex] ?? 0);
    const diff = Number(postSol - preSol) / 1e9;
    if (Math.abs(diff) > 0.001) {
      const amt = formatCompact(Math.abs(diff));
      if (diff > 0) return { type: "transfer-in", summary: `Received ${amt} SOL` };
      return { type: "transfer-out", summary: `Sent ${amt} SOL` };
    }
  }

  return null;
}

export function classifyTransaction(tx: ParsedTransaction, walletAddress: string): ClassifiedTx {
  const programs = tx.transaction.message.instructions.map((ix) => ix.programId);
  if (programs.includes(JUPITER_PROGRAM_ID)) {
    return { type: "swap", summary: buildSwapSummary(tx, walletAddress) };
  }
  const transfer = detectTransfer(tx, walletAddress);
  if (transfer) return transfer;
  return { type: "unknown", summary: "Unknown" };
}
