import { type Rpc, type SolanaRpcApi, address } from "@solana/kit";
import type { TokenBalance } from "../types/portfolio.js";
import { NATIVE_SOL_MINT } from "../format/index.js";

/** SPL Token program ID. */
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Token-2022 (Token Extensions) program ID. */
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Fetch native SOL balance for a wallet. */
async function fetchSolBalance(
  rpc: Rpc<SolanaRpcApi>,
  walletAddress: string,
): Promise<TokenBalance> {
  const result = await rpc
    .getBalance(address(walletAddress))
    .send();

  const rawBalance = result.value;
  const decimals = 9;

  return {
    mint: NATIVE_SOL_MINT,
    rawBalance,
    decimals,
    balance: Number(rawBalance) / 10 ** decimals,
    isNative: true,
  };
}

/** Shape returned by getTokenAccountsByOwner with jsonParsed encoding. */
interface ParsedTokenAccountInfo {
  mint: string;
  tokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
  };
}

/** Fetch token accounts for a wallet under a specific token program. */
async function fetchTokenAccounts(
  rpc: Rpc<SolanaRpcApi>,
  walletAddress: string,
  programId: string,
): Promise<TokenBalance[]> {
  const result = await rpc
    .getTokenAccountsByOwner(
      address(walletAddress),
      { programId: address(programId) },
      { encoding: "jsonParsed" },
    )
    .send();

  const balances: TokenBalance[] = [];

  for (const item of result.value) {
    const info = item.account.data.parsed.info as ParsedTokenAccountInfo;
    const rawBalance = BigInt(info.tokenAmount.amount);

    // Skip zero-balance accounts.
    if (rawBalance === 0n) continue;

    balances.push({
      mint: info.mint,
      rawBalance,
      decimals: info.tokenAmount.decimals,
      balance: info.tokenAmount.uiAmount ?? Number(rawBalance) / 10 ** info.tokenAmount.decimals,
      isNative: false,
    });
  }

  return balances;
}

/**
 * Fetch all token balances for a wallet — native SOL + SPL tokens.
 * Returns a unified list sorted by balance descending (SOL first when present).
 */
export async function fetchAllBalances(
  rpc: Rpc<SolanaRpcApi>,
  walletAddress: string,
): Promise<TokenBalance[]> {
  let solBalance: TokenBalance;
  let splBalances: TokenBalance[];
  let token2022Balances: TokenBalance[];
  try {
    [solBalance, splBalances, token2022Balances] = await Promise.all([
      fetchSolBalance(rpc, walletAddress),
      fetchTokenAccounts(rpc, walletAddress, TOKEN_PROGRAM_ID),
      fetchTokenAccounts(rpc, walletAddress, TOKEN_2022_PROGRAM_ID),
    ]);
  } catch {
    throw new Error("Could not fetch wallet balances. Check your RPC connection.");
  }

  const all = [solBalance, ...splBalances, ...token2022Balances];

  // Sort: native SOL first, then by balance descending.
  all.sort((a, b) => {
    if (a.isNative) return -1;
    if (b.isNative) return 1;
    return b.balance - a.balance;
  });

  return all;
}
