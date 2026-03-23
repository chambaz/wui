import { type Rpc, type SolanaRpcApi, address, signature } from "@solana/kit";
import { NATIVE_SOL_MINT } from "../lib/format.js";
import { fetchTokenMetadata } from "../pricing/index.js";
import type { ActivityEntry } from "../types/activity.js";
import { classifyTransaction } from "./summarize.js";
import type { SignatureEntry, ParsedTransaction } from "./types.js";

const FETCH_MULTIPLIER = 5;
const MAX_SIGNATURE_PAGES = 5;

function walletIsSigner(tx: ParsedTransaction, walletAddress: string): boolean {
  return tx.transaction.message.accountKeys.some((k) => k.pubkey === walletAddress && k.signer);
}

export async function fetchRecentActivity(
  rpc: Rpc<SolanaRpcApi>,
  walletAddress: string,
  apiKey: string,
  limit = 5,
): Promise<ActivityEntry[]> {
  const BATCH_SIZE = 10;
  const signerTxs: Array<{ sig: SignatureEntry; tx: ParsedTransaction }> = [];
  let before: string | undefined;

  for (let page = 0; page < MAX_SIGNATURE_PAGES && signerTxs.length < limit; page += 1) {
    const signatures = await rpc
      .getSignaturesForAddress(address(walletAddress), {
        limit: limit * FETCH_MULTIPLIER,
        ...(before ? { before: signature(before) } : {}),
      })
      .send();

    if (signatures.length === 0) break;

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

    for (const result of txResults) {
      if (result.tx && walletIsSigner(result.tx, walletAddress)) {
        signerTxs.push({ sig: result.sig, tx: result.tx });
        if (signerTxs.length >= limit) break;
      }
    }

    before = sigEntries[sigEntries.length - 1]?.signature;
  }

  const allMints = new Set<string>();
  for (const { tx } of signerTxs) {
    if (!tx?.meta) continue;
    for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) {
      if (b.mint !== NATIVE_SOL_MINT) allMints.add(b.mint);
    }
  }
  if (allMints.size > 0) {
    await fetchTokenMetadata([...allMints], apiKey).catch(() => {
      /* Non-critical — will fall back to truncated mints. */
    });
  }

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
