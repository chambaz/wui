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
  AccountRole,
  getU32Encoder,
  getU64Encoder,
  getU8Encoder,
  getStructEncoder,
  getProgramDerivedAddress,
  getAddressEncoder,
} from "@solana/kit";
import type { TransferRequest, TransferResult } from "../types/transfer.js";
import { formatTransactionError } from "../errors/index.js";
import { NATIVE_SOL_MINT } from "../format/index.js";

/** Program addresses. */
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Minimum SOL to keep in wallet for rent + fees. */
const MIN_SOL_RESERVE_LAMPORTS = 5_000_000n; // 0.005 SOL

/** Confirmation polling. */
const CONFIRMATION_POLL_INTERVAL_MS = 2_000;
const CONFIRMATION_TIMEOUT_MS = 60_000;

// --- Instruction encoders ---

const systemTransferEncoder = getStructEncoder([
  ["instruction", getU32Encoder()],
  ["lamports", getU64Encoder()],
]);

/** TransferChecked instruction layout (index 12): works for both SPL Token and Token-2022. */
const tokenTransferCheckedEncoder = getStructEncoder([
  ["instruction", getU8Encoder()],
  ["amount", getU64Encoder()],
  ["decimals", getU8Encoder()],
]);

// --- ATA helpers ---

/** Derive the Associated Token Account address for a given owner and mint. */
async function getAssociatedTokenAddress(
  owner: string,
  mint: string,
  tokenProgram: string = TOKEN_PROGRAM,
): Promise<string> {
  const addressEncoder = getAddressEncoder();
  const seeds = [
    addressEncoder.encode(address(owner)),
    addressEncoder.encode(address(tokenProgram)),
    addressEncoder.encode(address(mint)),
  ];
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds,
  });
  return ata;
}

/** Check if a token account exists on-chain. */
async function accountExists(
  rpc: Rpc<SolanaRpcApi>,
  accountAddress: string,
): Promise<boolean> {
  const info = await rpc
    .getAccountInfo(address(accountAddress), { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
    .send();
  return info.value !== null;
}

/** Build the create ATA instruction. */
function buildCreateAtaInstruction(
  payer: string,
  ataAddress: string,
  owner: string,
  mint: string,
  tokenProgram: string = TOKEN_PROGRAM,
) {
  return {
    programAddress: address(ATA_PROGRAM),
    accounts: [
      { address: address(payer), role: AccountRole.WRITABLE_SIGNER },
      { address: address(ataAddress), role: AccountRole.WRITABLE },
      { address: address(owner), role: AccountRole.READONLY },
      { address: address(mint), role: AccountRole.READONLY },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: address(tokenProgram), role: AccountRole.READONLY },
    ],
    data: new Uint8Array(0),
  };
}

// --- Transfer instruction builders ---

/** Build a native SOL transfer instruction. */
function buildSolTransferInstruction(from: string, to: string, lamports: bigint) {
  return {
    programAddress: address(SYSTEM_PROGRAM),
    accounts: [
      { address: address(from), role: AccountRole.WRITABLE_SIGNER },
      { address: address(to), role: AccountRole.WRITABLE },
    ],
    data: systemTransferEncoder.encode({ instruction: 2, lamports }),
  };
}

/**
 * Build a TransferChecked instruction (index 12).
 * Works for both SPL Token and Token-2022 (including tokens with transfer fees).
 * Unlike basic Transfer (index 3), this includes the mint and decimals
 * which Token-2022 requires for fee validation.
 */
function buildTokenTransferInstruction(
  sourceAta: string,
  destAta: string,
  owner: string,
  mint: string,
  amount: bigint,
  decimals: number,
  tokenProgram: string = TOKEN_PROGRAM,
) {
  return {
    programAddress: address(tokenProgram),
    accounts: [
      { address: address(sourceAta), role: AccountRole.WRITABLE },
      { address: address(mint), role: AccountRole.READONLY },
      { address: address(destAta), role: AccountRole.WRITABLE },
      { address: address(owner), role: AccountRole.WRITABLE_SIGNER },
    ],
    data: tokenTransferCheckedEncoder.encode({ instruction: 12, amount, decimals }),
  };
}

// --- Send and confirm ---

/** Send a signed transaction and poll for confirmation. */
async function sendAndConfirm(
  rpc: Rpc<SolanaRpcApi>,
  signedBase64: ReturnType<typeof getBase64EncodedWireTransaction>,
  lastValidBlockHeight: bigint,
): Promise<string> {
  const signature = await rpc
    .sendTransaction(signedBase64, {
      encoding: "base64",
      skipPreflight: true,
    })
    .send();

  const startTime = Date.now();

  while (Date.now() - startTime < CONFIRMATION_TIMEOUT_MS) {
    const blockHeight = await rpc.getBlockHeight().send();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error(
        "Transaction expired before confirmation. " +
        "The transfer was not executed. Try again.",
      );
    }

    const { value: statuses } = await rpc
      .getSignatureStatuses([signature])
      .send();

    const status = statuses[0];
    if (status) {
      if (status.err) {
        throw new Error(formatTransactionError(status.err));
      }
      if (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      ) {
        return signature;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS));
  }

  throw new Error(`Transaction confirmation timed out. Check status manually: ${signature}`);
}

// --- Determine token program ---

/** Determine which token program a mint belongs to (Token or Token-2022). */
async function getTokenProgramForMint(
  rpc: Rpc<SolanaRpcApi>,
  mint: string,
): Promise<string> {
  const info = await rpc
    .getAccountInfo(address(mint), { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
    .send();
  if (info.value?.owner === TOKEN_2022_PROGRAM) {
    return TOKEN_2022_PROGRAM;
  }
  return TOKEN_PROGRAM;
}

// --- Public API ---

/**
 * Execute a token transfer: build, sign, send, and confirm.
 * Handles native SOL, SPL tokens, and Token-2022.
 * Creates recipient ATA if it doesn't exist.
 */
export async function executeTransfer(
  request: TransferRequest,
  signer: KeyPairSigner,
  rpc: Rpc<SolanaRpcApi>,
  onStatus?: (status: string) => void,
): Promise<TransferResult> {
  let currentStep = "building transaction";
  try {
    onStatus?.("Building transaction...");

    // Get latest blockhash for transaction lifetime.
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    // Build base transaction message.
    const baseMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(address(signer.address), msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => addSignersToTransactionMessage([signer], msg),
    );

    let txMessage;

    if (request.isNative) {
      // Native SOL transfer — single instruction.
      const ix = buildSolTransferInstruction(signer.address, request.recipient, request.amount);
      txMessage = appendTransactionMessageInstruction(ix, baseMessage);
    } else {
      // SPL Token transfer.
      const tokenProgram = await getTokenProgramForMint(rpc, request.mint);

      const sourceAta = await getAssociatedTokenAddress(
        signer.address, request.mint, tokenProgram,
      );
      const destAta = await getAssociatedTokenAddress(
        request.recipient, request.mint, tokenProgram,
      );

      // Check if we need to create the recipient's token account.
      const destAtaExists = await accountExists(rpc, destAta);

      if (!destAtaExists) {
        onStatus?.("Creating recipient token account...");
        const createAtaIx = buildCreateAtaInstruction(
          signer.address, destAta, request.recipient, request.mint, tokenProgram,
        );
        const transferIx = buildTokenTransferInstruction(
          sourceAta, destAta, signer.address, request.mint, request.amount, request.decimals, tokenProgram,
        );
        txMessage = pipe(
          baseMessage,
          (msg) => appendTransactionMessageInstruction(createAtaIx, msg),
          (msg) => appendTransactionMessageInstruction(transferIx, msg),
        );
      } else {
        const transferIx = buildTokenTransferInstruction(
          sourceAta, destAta, signer.address, request.mint, request.amount, request.decimals, tokenProgram,
        );
        txMessage = appendTransactionMessageInstruction(transferIx, baseMessage);
      }
    }

    // Sign.
    currentStep = "signing transaction";
    onStatus?.("Signing transaction...");
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encoded = getBase64EncodedWireTransaction(signedTx);

    // Send and confirm.
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

/** Validate a Solana address. Returns true if it can be parsed by @solana/kit. */
export function isValidSolanaAddress(addr: string): boolean {
  try {
    address(addr);
    return true;
  } catch {
    return false;
  }
}

/** Calculate max sendable SOL (total balance minus reserve for rent + fees). */
export function maxSendableSol(balanceLamports: bigint): bigint {
  const max = balanceLamports - MIN_SOL_RESERVE_LAMPORTS;
  return max > 0n ? max : 0n;
}
