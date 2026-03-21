import type { ActivityType } from "../types/activity.js";

export interface SignatureEntry {
  signature: string;
  blockTime: bigint | null;
  confirmationStatus: string;
  err: unknown;
  memo: string | null;
}

export interface TokenBalanceEntry {
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

export interface ParsedTransactionMeta {
  err: unknown;
  preBalances: bigint[];
  postBalances: bigint[];
  preTokenBalances: TokenBalanceEntry[];
  postTokenBalances: TokenBalanceEntry[];
}

export interface ParsedInstruction {
  programId: string;
  program?: string;
  parsed?: {
    type?: string;
    info?: Record<string, unknown>;
  };
}

export interface ParsedTransaction {
  blockTime: bigint | null;
  meta: ParsedTransactionMeta | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean }>;
      instructions: ParsedInstruction[];
    };
  };
}

export interface ClassifiedTx {
  type: ActivityType;
  summary: string;
}
