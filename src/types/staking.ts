/** Possible states of a native stake account. */
export type StakeStatus = "inactive" | "activating" | "active" | "deactivating" | "deactivated";

/** A native stake account belonging to the user's wallet. */
export interface StakeAccountInfo {
  address: string;
  lamports: bigint;
  balance: number;
  status: StakeStatus;
  validator: string | null;
  validatorLabel: string | null;
}

/** Staking provider identifier. */
export type StakeProviderId = "jito" | "p0";

/** Validator metadata for native staking. */
export interface ValidatorInfo {
  label: string;
  voteAccount: string;
}

/** Custom validator saved by the user. */
export interface CustomValidator {
  label: string;
  voteAccount: string;
}

/** A liquid staking provider (uses SPL Stake Pool). */
export interface StakeProvider {
  id: StakeProviderId;
  label: string;
  /** SPL Stake Pool address. */
  stakePoolAddress: string;
  /** Liquid staking token mint. */
  lstMint: string;
}

/** The target for a new stake operation. */
export type StakeTarget =
  | { mode: "liquid"; provider: StakeProvider }
  | { mode: "native"; validator: ValidatorInfo };
