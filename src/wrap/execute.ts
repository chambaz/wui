import {
  type Rpc,
  type SolanaRpcApi,
  type KeyPairSigner,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  addSignersToTransactionMessage,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { sendAndConfirmTransaction } from "../lib/confirm.js";
import { NATIVE_SOL_MINT } from "../lib/format.js";
import { buildCreateAtaInstruction } from "../transfer/ata.js";
import { buildSolTransferInstruction } from "../transfer/instructions.js";
import { TOKEN_PROGRAM } from "../transfer/constants.js";
import type { WrapRequest, WrapResult } from "../types/wrap.js";
import { getMaxWrappableLamports, getWrapAvailability } from "./accounts.js";
import { buildCloseAccountInstruction, buildSyncNativeInstruction } from "./instructions.js";

export async function executeWrapAction(
  request: WrapRequest,
  signer: KeyPairSigner,
  rpc: Rpc<SolanaRpcApi>,
  onStatus?: (status: string) => void,
): Promise<WrapResult> {
  let currentStep = "loading balances";

  try {
    const availability = await getWrapAvailability(rpc, signer.address);

    if (request.action === "wrap") {
      if (request.amount <= 0n) {
        throw new Error("Amount must be greater than 0.");
      }

      const maxWrappableLamports = getMaxWrappableLamports(availability);
      if (request.amount > maxWrappableLamports) {
        throw new Error("Amount exceeds the available SOL after reserve requirements.");
      }
    } else if (!availability.wrappedSolAccountExists) {
      throw new Error("Standard Wrapped SOL account not found.");
    } else if (availability.wrappedSolRawBalance <= 0n) {
      throw new Error("No Wrapped SOL available in the standard account.");
    }

    currentStep = "building transaction";
    onStatus?.("Building transaction...");
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const baseMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(address(signer.address), message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
      (message) => addSignersToTransactionMessage([signer], message),
    );

    let txMessage;
    if (request.action === "wrap") {
      const transferIx = buildSolTransferInstruction(
        signer.address,
        availability.wrappedSolAccountAddress,
        request.amount,
      );
      const syncNativeIx = buildSyncNativeInstruction(availability.wrappedSolAccountAddress);

      txMessage = baseMessage;
      if (!availability.wrappedSolAccountExists) {
        const createAtaIx = buildCreateAtaInstruction(
          signer.address,
          availability.wrappedSolAccountAddress,
          signer.address,
          NATIVE_SOL_MINT,
          TOKEN_PROGRAM,
        );
        txMessage = appendTransactionMessageInstruction(createAtaIx, txMessage);
      }

      txMessage = pipe(
        txMessage,
        (message) => appendTransactionMessageInstruction(transferIx, message),
        (message) => appendTransactionMessageInstruction(syncNativeIx, message),
      );
    } else {
      const closeAccountIx = buildCloseAccountInstruction(
        availability.wrappedSolAccountAddress,
        signer.address,
        signer.address,
      );
      txMessage = appendTransactionMessageInstruction(closeAccountIx, baseMessage);
    }

    currentStep = "signing transaction";
    onStatus?.("Signing transaction...");
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encoded = getBase64EncodedWireTransaction(signedTx);

    currentStep = "sending transaction";
    onStatus?.("Broadcasting transaction...");
    const signature = await sendAndConfirmTransaction({
      rpc,
      signedTransaction: encoded,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      expiredMessage:
        request.action === "wrap"
          ? "Transaction expired before confirmation. The wrap was not executed. Try again."
          : "Transaction expired before confirmation. The unwrap was not executed. Try again.",
    });

    return {
      success: true,
      signature,
      action: request.action,
      amount: request.action === "wrap" ? request.amount : availability.wrappedSolRawBalance,
      error: null,
    };
  } catch (err: unknown) {
    return {
      success: false,
      signature: null,
      action: request.action,
      amount: request.amount,
      error: `Failed while ${currentStep}: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
