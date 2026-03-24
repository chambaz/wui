import { type Rpc, type SolanaRpcApi, address } from "@solana/kit";
import type { StakeAccountInfo, StakeStatus } from "../types/staking.js";
import { MAX_EPOCH, STAKE_ACCOUNT_SIZE } from "./constants.js";
import { loadCustomValidators, resolveValidatorLabel } from "./validators-store.js";

function getStakeAccountStatus(
  activationEpoch: bigint,
  deactivationEpoch: bigint,
  currentEpoch: bigint,
): StakeStatus {
  if (deactivationEpoch !== MAX_EPOCH) {
    return currentEpoch > deactivationEpoch ? "deactivated" : "deactivating";
  }
  if (currentEpoch === activationEpoch) return "activating";
  return "active";
}

export async function fetchStakeAccounts(
  rpc: Rpc<SolanaRpcApi>,
  walletAddress: string,
): Promise<StakeAccountInfo[]> {
  const epochInfo = await rpc.getEpochInfo().send();
  const currentEpoch = BigInt(epochInfo.epoch);
  const savedValidators = loadCustomValidators();

  const accounts = await rpc
    .getProgramAccounts(address("Stake11111111111111111111111111111111111111"), {
      encoding: "jsonParsed",
      filters: [
        { dataSize: STAKE_ACCOUNT_SIZE },
        { memcmp: { offset: 44n, bytes: walletAddress as never, encoding: "base58" } },
      ],
    })
    .send();

  const result: StakeAccountInfo[] = [];
  for (const account of accounts) {
    const lamports = account.account.lamports;
    const parsed = account.account.data as unknown as {
      parsed?: { info?: { stake?: { delegation?: { voter?: string; activationEpoch?: string; deactivationEpoch?: string } } } };
    };
    const delegation = parsed?.parsed?.info?.stake?.delegation;
    const validator = delegation?.voter ?? null;

    let status: StakeStatus = "inactive";
    if (delegation?.activationEpoch !== undefined && delegation?.deactivationEpoch !== undefined) {
      status = getStakeAccountStatus(BigInt(delegation.activationEpoch), BigInt(delegation.deactivationEpoch), currentEpoch);
    }

    result.push({
      address: account.pubkey,
      lamports,
      balance: Number(lamports) / 1e9,
      status,
      validator,
      validatorLabel: validator ? resolveValidatorLabel(validator, savedValidators) : null,
    });
  }

  const statusOrder: Record<StakeStatus, number> = { active: 0, activating: 1, deactivating: 2, deactivated: 3, inactive: 4 };
  result.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.balance - a.balance);
  return result;
}
