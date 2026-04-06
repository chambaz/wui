export type WrapAction = "wrap" | "unwrap";

export interface WrapAvailability {
  walletAddress: string;
  nativeSolRawBalance: bigint;
  nativeSolBalance: number;
  wrappedSolAccountAddress: string;
  wrappedSolAccountExists: boolean;
  wrappedSolRawBalance: bigint;
  wrappedSolBalance: number;
  extraWrappedSolRawBalance: bigint;
  extraWrappedSolBalance: number;
  wrappedSolAccountRentLamports: bigint;
}

export interface WrapRequest {
  action: WrapAction;
  amount: bigint;
}

export interface WrapResult {
  success: boolean;
  signature: string | null;
  action: WrapAction;
  amount: bigint;
  error: string | null;
}
