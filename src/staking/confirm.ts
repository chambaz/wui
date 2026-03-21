import { type Rpc, type SolanaRpcApi, getBase64EncodedWireTransaction } from "@solana/kit";
import { formatTransactionError } from "../lib/errors.js";
import { CONFIRMATION_POLL_INTERVAL_MS, CONFIRMATION_TIMEOUT_MS } from "./constants.js";

export async function sendAndConfirm(
  rpc: Rpc<SolanaRpcApi>,
  signedBase64: ReturnType<typeof getBase64EncodedWireTransaction>,
  lastValidBlockHeight: bigint,
): Promise<string> {
  const signature = await rpc
    .sendTransaction(signedBase64, { encoding: "base64", skipPreflight: true })
    .send();

  const startTime = Date.now();
  while (Date.now() - startTime < CONFIRMATION_TIMEOUT_MS) {
    const blockHeight = await rpc.getBlockHeight().send();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error("Transaction expired before confirmation. Try again.");
    }
    const { value: statuses } = await rpc.getSignatureStatuses([signature]).send();
    const status = statuses[0];
    if (status) {
      if (status.err) throw new Error(formatTransactionError(status.err));
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return signature;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS));
  }

  throw new Error(`Transaction confirmation timed out. Check status manually: ${signature}`);
}
