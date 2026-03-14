/** Recognized transaction types. */
export type ActivityType = "swap" | "transfer-in" | "transfer-out" | "unknown";

/** A decoded activity entry for display. */
export interface ActivityEntry {
  /** Transaction signature. */
  signature: string;
  /** Classified transaction type. */
  type: ActivityType;
  /** Human-readable summary (e.g. "Swapped 1 SOL → 150 USDC"). */
  summary: string;
  /** Unix timestamp in seconds (null if not available). */
  timestamp: number | null;
  /** Whether the transaction succeeded. */
  success: boolean;
  /** Error description if the transaction failed. */
  error: string | null;
}
