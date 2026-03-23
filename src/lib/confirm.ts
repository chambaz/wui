import { type Rpc, type SolanaRpcApi, type Base64EncodedWireTransaction } from "@solana/kit";
import { formatTransactionError } from "./errors.js";

const CONFIRMATION_POLL_INTERVAL_MS = 2_000;
const CONFIRMATION_TIMEOUT_MS = 60_000;

interface SendAndConfirmOptions {
  rpc: Rpc<SolanaRpcApi>;
  signedTransaction: Base64EncodedWireTransaction;
  lastValidBlockHeight: bigint;
  expiredMessage: string;
}

export async function sendAndConfirmTransaction({
  rpc,
  signedTransaction,
  lastValidBlockHeight,
  expiredMessage,
}: SendAndConfirmOptions): Promise<string> {
  const signature = await rpc
    .sendTransaction(signedTransaction, { encoding: "base64", skipPreflight: true })
    .send();

  const startTime = Date.now();
  while (Date.now() - startTime < CONFIRMATION_TIMEOUT_MS) {
    const blockHeight = await rpc.getBlockHeight().send();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error(expiredMessage);
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
