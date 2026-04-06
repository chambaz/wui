/** Parameters for a token transfer. */
export interface TransferRequest {
  /** Mint address (wrapped SOL mint for native SOL). */
  mint: string;
  /** Source token account address for SPL transfers, null for native SOL. */
  sourceAccountAddress?: string | null;
  /** Recipient wallet address. */
  recipient: string;
  /** Raw amount in smallest units (lamports / atomic units). */
  amount: bigint;
  /** Token decimals. */
  decimals: number;
  /** Whether this is a native SOL transfer. */
  isNative: boolean;
}

/** Result of executing a transfer. */
export interface TransferResult {
  success: boolean;
  signature: string | null;
  mint: string;
  recipient: string;
  amount: bigint;
  decimals: number;
  error: string | null;
}
