import { type Rpc, type SolanaRpcApi, type Base64EncodedWireTransaction } from "@solana/kit";
import { sendAndConfirmTransaction } from "../lib/confirm.js";

export function sendAndConfirm(
  rpc: Rpc<SolanaRpcApi>,
  signedTransaction: Base64EncodedWireTransaction,
  lastValidBlockHeight: bigint,
): Promise<string> {
  return sendAndConfirmTransaction({
    rpc,
    signedTransaction,
    lastValidBlockHeight,
    expiredMessage: "Transaction expired before confirmation. Try again.",
  });
}
