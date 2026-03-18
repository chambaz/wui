import { type Rpc, type SolanaRpcApi, address, signature } from "@solana/kit";
import type { ActivityEntry, ActivityType } from "../types/activity.js";
import { getTokenMetadata, fetchTokenMetadata } from "../pricing/index.js";
import { NATIVE_SOL_MINT, formatCompact } from "../format/index.js";

/** Known program IDs for classification. */
const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";



/**
 * Fetch more signatures than needed so we can filter to signer-only
 * transactions and still return `limit` results.
 */
const FETCH_MULTIPLIER = 5;

/** Shape of a signature response entry from getSignaturesForAddress. */
interface SignatureEntry {
  signature: string;
  blockTime: bigint | null;
  confirmationStatus: string;
  err: unknown;
  memo: string | null;
}

/** Token balance change used for transfer detection. */
interface TokenBalanceEntry {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}

/** Minimal parsed transaction shape for classification. */
interface ParsedTransactionMeta {
  err: unknown;
  preBalances: bigint[];
  postBalances: bigint[];
  preTokenBalances: TokenBalanceEntry[];
  postTokenBalances: TokenBalanceEntry[];
}

interface ParsedInstruction {
  programId: string;
  program?: string;
  parsed?: {
    type?: string;
    info?: Record<string, unknown>;
  };
}

interface ParsedTransaction {
  blockTime: bigint | null;
  meta: ParsedTransactionMeta | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean }>;
      instructions: ParsedInstruction[];
    };
  };
}

/** Check if the wallet was a signer on this transaction. */
function walletIsSigner(tx: ParsedTransaction, walletAddress: string): boolean {
  return tx.transaction.message.accountKeys.some(
    (k) => k.pubkey === walletAddress && k.signer,
  );
}

/** Resolve a mint to its symbol, falling back to a truncated address. */
function mintSymbol(mint: string): string {
  const meta = getTokenMetadata(mint);
  if (meta) return meta.symbol;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

/**
 * Classify a transaction based on its instructions and balance changes.
 * Returns the activity type and a human-readable summary.
 */
function classifyTransaction(
  tx: ParsedTransaction,
  walletAddress: string,
): { type: ActivityType; summary: string } {
  const programs = tx.transaction.message.instructions.map((ix) => ix.programId);

  // Jupiter swap detection.
  if (programs.includes(JUPITER_PROGRAM_ID)) {
    return { type: "swap", summary: buildSwapSummary(tx, walletAddress) };
  }

  // SOL or SPL transfer detection via balance changes.
  const transfer = detectTransfer(tx, walletAddress);
  if (transfer) return transfer;

  return { type: "unknown", summary: "Unknown" };
}

/** Build a swap summary from token balance changes and SOL diffs. */
function buildSwapSummary(tx: ParsedTransaction, walletAddress: string): string {
  if (!tx.meta) return "Swap";

  // Get token changes excluding wrapped SOL (tracked via native SOL balance).
  const tokenChanges = computeTokenChanges(
    tx.meta.preTokenBalances,
    tx.meta.postTokenBalances,
    walletAddress,
  ).filter((c) => c.mint !== NATIVE_SOL_MINT);

  // Get native SOL balance change.
  const walletIndex = tx.transaction.message.accountKeys.findIndex(
    (k) => k.pubkey === walletAddress,
  );
  const solDiff = walletIndex >= 0
    ? Number(BigInt(tx.meta.postBalances[walletIndex] ?? 0) - BigInt(tx.meta.preBalances[walletIndex] ?? 0)) / 1e9
    : 0;

  // Build a combined list of all value changes (SOL + tokens).
  const allChanges: Array<{ label: string; delta: number }> = [];

  // Include SOL if the change is significant (> fees).
  if (Math.abs(solDiff) > 0.001) {
    allChanges.push({ label: "SOL", delta: solDiff });
  }

  for (const c of tokenChanges) {
    allChanges.push({ label: mintSymbol(c.mint), delta: c.delta });
  }

  const sold = allChanges.find((c) => c.delta < 0);
  const bought = allChanges.find((c) => c.delta > 0);

  if (sold && bought) {
    return `${formatCompact(Math.abs(sold.delta))} ${sold.label} → ${formatCompact(bought.delta)} ${bought.label}`;
  }

  return "Swap";
}

/** Detect SOL or token transfers. */
function detectTransfer(
  tx: ParsedTransaction,
  walletAddress: string,
): { type: ActivityType; summary: string } | null {
  if (!tx.meta) return null;

  const accountKeys = tx.transaction.message.accountKeys;
  const walletIndex = accountKeys.findIndex((k) => k.pubkey === walletAddress);

  // Check for token transfers first (more specific).
  const tokenChanges = computeTokenChanges(
    tx.meta.preTokenBalances,
    tx.meta.postTokenBalances,
    walletAddress,
  );

  if (tokenChanges.length === 1) {
    const c = tokenChanges[0];
    const amt = formatCompact(Math.abs(c.delta));
    const symbol = mintSymbol(c.mint);
    if (c.delta > 0) {
      return { type: "transfer-in", summary: `Received ${amt} ${symbol}` };
    }
    return { type: "transfer-out", summary: `Sent ${amt} ${symbol}` };
  }

  // Check for SOL transfer via balance changes.
  if (walletIndex >= 0) {
    const preSol = BigInt(tx.meta.preBalances[walletIndex] ?? 0);
    const postSol = BigInt(tx.meta.postBalances[walletIndex] ?? 0);
    const diff = Number(postSol - preSol) / 1e9;

    // Ignore tiny changes (fees only).
    if (Math.abs(diff) > 0.001) {
      const amt = formatCompact(Math.abs(diff));
      if (diff > 0) {
        return { type: "transfer-in", summary: `Received ${amt} SOL` };
      }
      return { type: "transfer-out", summary: `Sent ${amt} SOL` };
    }
  }

  return null;
}

/** Compute token balance changes for a specific owner. */
function computeTokenChanges(
  pre: TokenBalanceEntry[],
  post: TokenBalanceEntry[],
  owner: string,
): Array<{ mint: string; delta: number }> {
  const preMap = new Map<string, number>();
  for (const b of pre) {
    if (b.owner === owner) {
      preMap.set(b.mint, Number(b.uiTokenAmount.uiAmount ?? 0));
    }
  }

  const postMap = new Map<string, number>();
  for (const b of post) {
    if (b.owner === owner) {
      postMap.set(b.mint, Number(b.uiTokenAmount.uiAmount ?? 0));
    }
  }

  const allMints = new Set([...preMap.keys(), ...postMap.keys()]);
  const changes: Array<{ mint: string; delta: number }> = [];

  for (const mint of allMints) {
    const preBal = preMap.get(mint) ?? 0;
    const postBal = postMap.get(mint) ?? 0;
    const delta = postBal - preBal;
    if (Math.abs(delta) > 1e-9) {
      changes.push({ mint, delta });
    }
  }

  return changes;
}

/**
 * Fetch recent activity for a wallet.
 * Only includes transactions where the wallet was a signer (filters spam).
 * Returns classified and summarized entries, most recent first.
 */
export async function fetchRecentActivity(
  rpc: Rpc<SolanaRpcApi>,
  walletAddress: string,
  apiKey: string,
  limit: number = 5,
): Promise<ActivityEntry[]> {
  // Fetch extra signatures to account for spam filtering.
  const fetchCount = limit * FETCH_MULTIPLIER;
  const signatures = await rpc
    .getSignaturesForAddress(address(walletAddress), { limit: fetchCount })
    .send();

  if (signatures.length === 0) return [];

  // Fetch parsed transactions in batches to avoid RPC rate limits.
  const BATCH_SIZE = 10;
  const sigEntries = signatures as readonly SignatureEntry[];
  const txResults: Array<{ sig: SignatureEntry; tx: ParsedTransaction | null }> = [];

  for (let i = 0; i < sigEntries.length; i += BATCH_SIZE) {
    const batch = sigEntries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (sig) => {
        try {
          const tx = await rpc
            .getTransaction(signature(sig.signature), {
              encoding: "jsonParsed",
              maxSupportedTransactionVersion: 0,
            })
            .send();
          return { sig, tx: tx as ParsedTransaction | null };
        } catch {
          return { sig, tx: null };
        }
      }),
    );
    txResults.push(...batchResults);
  }

  // Filter to signer-only transactions.
  const signerTxs = txResults.filter(
    ({ tx }) => tx !== null && walletIsSigner(tx, walletAddress),
  ).slice(0, limit);

  // Collect all unique mints from these transactions and pre-fetch metadata.
  const allMints = new Set<string>();
  for (const { tx } of signerTxs) {
    if (!tx?.meta) continue;
    for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) {
      if (b.mint !== NATIVE_SOL_MINT) {
        allMints.add(b.mint);
      }
    }
  }
  if (allMints.size > 0) {
    await fetchTokenMetadata([...allMints], apiKey).catch(() => {
      /* Non-critical — will fall back to truncated mints. */
    });
  }

  // Classify and build entries.
  const entries: ActivityEntry[] = [];

  for (const { sig, tx } of signerTxs) {
    if (!tx) continue;

    const { type, summary } = classifyTransaction(tx, walletAddress);

    entries.push({
      signature: sig.signature,
      type,
      summary,
      timestamp: sig.blockTime ? Number(sig.blockTime) : null,
      success: sig.err === null,
      error: sig.err ? JSON.stringify(sig.err, (_k, v) => typeof v === "bigint" ? v.toString() : v) : null,
    });
  }

  return entries;
}
