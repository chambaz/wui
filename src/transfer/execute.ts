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
import { formatTransactionError } from "../lib/errors.js";
import type { TransferRequest, TransferResult } from "../types/transfer.js";
import { CONFIRMATION_POLL_INTERVAL_MS, CONFIRMATION_TIMEOUT_MS, MIN_SOL_RESERVE_LAMPORTS } from "./constants.js";
import { getAssociatedTokenAddress, accountExists, buildCreateAtaInstruction } from "./ata.js";
import { getTokenProgramForMint } from "./token-program.js";
import { buildSolTransferInstruction, buildTokenTransferInstruction } from "./instructions.js";

async function sendAndConfirm(
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
      throw new Error("Transaction expired before confirmation. The transfer was not executed. Try again.");
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

export async function executeTransfer(
  request: TransferRequest,
  signer: KeyPairSigner,
  rpc: Rpc<SolanaRpcApi>,
  onStatus?: (status: string) => void,
): Promise<TransferResult> {
  let currentStep = "building transaction";
  try {
    onStatus?.("Building transaction...");
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const baseMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(address(signer.address), msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => addSignersToTransactionMessage([signer], msg),
    );

    let txMessage;
    if (request.isNative) {
      const ix = buildSolTransferInstruction(signer.address, request.recipient, request.amount);
      txMessage = appendTransactionMessageInstruction(ix, baseMessage);
    } else {
      const tokenProgram = await getTokenProgramForMint(rpc, request.mint);
      const sourceAta = await getAssociatedTokenAddress(signer.address, request.mint, tokenProgram);
      const destAta = await getAssociatedTokenAddress(request.recipient, request.mint, tokenProgram);
      const destAtaExists = await accountExists(rpc, destAta);

      if (!destAtaExists) {
        onStatus?.("Creating recipient token account...");
        const createAtaIx = buildCreateAtaInstruction(signer.address, destAta, request.recipient, request.mint, tokenProgram);
        const transferIx = buildTokenTransferInstruction(sourceAta, destAta, signer.address, request.mint, request.amount, request.decimals, tokenProgram);
        txMessage = pipe(
          baseMessage,
          (msg) => appendTransactionMessageInstruction(createAtaIx, msg),
          (msg) => appendTransactionMessageInstruction(transferIx, msg),
        );
      } else {
        const transferIx = buildTokenTransferInstruction(sourceAta, destAta, signer.address, request.mint, request.amount, request.decimals, tokenProgram);
        txMessage = appendTransactionMessageInstruction(transferIx, baseMessage);
      }
    }

    currentStep = "signing transaction";
    onStatus?.("Signing transaction...");
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encoded = getBase64EncodedWireTransaction(signedTx);

    currentStep = "sending transaction";
    onStatus?.("Broadcasting transaction...");
    const signature = await sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);

    return {
      success: true,
      signature,
      mint: request.mint,
      recipient: request.recipient,
      amount: request.amount,
      decimals: request.decimals,
      error: null,
    };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      signature: null,
      mint: request.mint,
      recipient: request.recipient,
      amount: request.amount,
      decimals: request.decimals,
      error: `Failed while ${currentStep}: ${raw}`,
    };
  }
}

export function isValidSolanaAddress(addr: string): boolean {
  try {
    address(addr);
    return true;
  } catch {
    return false;
  }
}

export function maxSendableSol(balanceLamports: bigint): bigint {
  const max = balanceLamports - MIN_SOL_RESERVE_LAMPORTS;
  return max > 0n ? max : 0n;
}
