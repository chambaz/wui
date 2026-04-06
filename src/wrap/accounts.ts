import { type Rpc, type SolanaRpcApi } from "@solana/kit";
import { NATIVE_SOL_MINT } from "../lib/format.js";
import { fetchAllBalances } from "../portfolio/index.js";
import { accountExists, getAssociatedTokenAddress } from "../transfer/ata.js";
import { MIN_SOL_RESERVE_LAMPORTS, TOKEN_PROGRAM } from "../transfer/constants.js";
import type { WrapAvailability } from "../types/wrap.js";

const TOKEN_ACCOUNT_SIZE = 165n;

export async function getStandardWrappedSolAccountAddress(walletAddress: string): Promise<string> {
  return getAssociatedTokenAddress(walletAddress, NATIVE_SOL_MINT, TOKEN_PROGRAM);
}

export async function getWrapAvailability(
  rpc: Rpc<SolanaRpcApi>,
  walletAddress: string,
): Promise<WrapAvailability> {
  const [balances, wrappedSolAccountAddress, wrappedSolAccountRentLamports] = await Promise.all([
    fetchAllBalances(rpc, walletAddress),
    getStandardWrappedSolAccountAddress(walletAddress),
    rpc.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE).send(),
  ]);

  const nativeSol = balances.find((balance) => balance.isNative);
  const standardWrappedSol = balances.find(
    (balance) => balance.assetKind === "wrapped-sol" && balance.accountAddress === wrappedSolAccountAddress,
  );

  let totalWrappedSolRawBalance = 0n;
  for (const balance of balances) {
    if (balance.assetKind === "wrapped-sol") {
      totalWrappedSolRawBalance += balance.rawBalance;
    }
  }

  const wrappedSolRawBalance = standardWrappedSol?.rawBalance ?? 0n;
  const extraWrappedSolRawBalance = totalWrappedSolRawBalance - wrappedSolRawBalance;
  const wrappedSolAccountExists = standardWrappedSol
    ? true
    : await accountExists(rpc, wrappedSolAccountAddress);

  return {
    nativeSolRawBalance: nativeSol?.rawBalance ?? 0n,
    nativeSolBalance: nativeSol?.balance ?? 0,
    wrappedSolAccountAddress,
    wrappedSolAccountExists,
    wrappedSolRawBalance,
    wrappedSolBalance: standardWrappedSol?.balance ?? 0,
    extraWrappedSolRawBalance,
    wrappedSolAccountRentLamports,
  };
}

export function getMaxWrappableLamports(availability: WrapAvailability): bigint {
  const ataFunding = availability.wrappedSolAccountExists ? 0n : availability.wrappedSolAccountRentLamports;
  const max = availability.nativeSolRawBalance - MIN_SOL_RESERVE_LAMPORTS - ataFunding;
  return max > 0n ? max : 0n;
}
