import {
  type Rpc,
  type SolanaRpcApi,
  type KeyPairSigner,
  type Base64EncodedWireTransaction,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionDecoder,
  getBase64EncodedWireTransaction,
  signTransaction,
} from "@solana/kit";
import type { SwapQuote, SwapQuoteRequest, SwapResult, RouteStep } from "../types/swap.js";
import { fetchWithTimeout, formatTransactionError } from "../errors/index.js";
import { JUPITER_BASE_URL } from "../format/index.js";

/** Default slippage tolerance in basis points (0.5%). */
export const DEFAULT_SLIPPAGE_BPS = 50;

/** Platform fee in basis points (0.3%). Collected on output token. */
const PLATFORM_FEE_BPS = 30;

/**
 * Wallet address that receives platform fees from swaps.
 * Replace with your actual fee collection wallet public key.
 */
const FEE_WALLET_ADDRESS = "3TZ4bdHjJaxempMDU9n7itvCEsFVYg5TyzjNWnvT5i6X";

/** SPL Token program address. */
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Associated Token Account program address. */
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Max priority fee in lamports (0.001 SOL cap as safety measure). */
const MAX_PRIORITY_FEE_LAMPORTS = 1_000_000;

/** Polling interval for transaction confirmation in milliseconds. */
const CONFIRMATION_POLL_INTERVAL_MS = 2_000;

/** Maximum time to wait for confirmation in milliseconds. */
const CONFIRMATION_TIMEOUT_MS = 60_000;

// --- Helpers ---

function jupiterHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

/** Derive the ATA address for the fee wallet and a given mint. */
async function deriveFeeTokenAccount(mint: string): Promise<string> {
  const encoder = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [
      encoder.encode(address(FEE_WALLET_ADDRESS)),
      encoder.encode(address(TOKEN_PROGRAM)),
      encoder.encode(address(mint)),
    ],
  });
  return ata;
}

/** Check if an account exists on-chain. */
async function feeAccountExists(
  rpc: Rpc<SolanaRpcApi>,
  accountAddress: string,
): Promise<boolean> {
  try {
    const info = await rpc
      .getAccountInfo(address(accountAddress), {
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
      })
      .send();
    return info.value !== null;
  } catch {
    return false;
  }
}

/**
 * Resolve the fee account for a swap's output mint.
 * Returns the ATA address if it exists on-chain, or null to skip fees.
 */
async function resolveFeeAccount(
  rpc: Rpc<SolanaRpcApi>,
  outputMint: string,
): Promise<string | null> {
  if (FEE_WALLET_ADDRESS.startsWith("TODO")) return null;
  try {
    const ata = await deriveFeeTokenAccount(outputMint);
    const exists = await feeAccountExists(rpc, ata);
    return exists ? ata : null;
  } catch {
    return null;
  }
}

/** Raw Jupiter quote response shape (fields we consume). */
interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label?: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
    };
    percent: number;
  }>;
}

/** Raw Jupiter swap response shape. */
interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

// --- Public API ---

/**
 * Request a swap quote from Jupiter Metis API.
 * Returns a structured quote with the raw response preserved for the swap step.
 */
export async function getSwapQuote(
  request: SwapQuoteRequest,
  apiKey: string,
  includePlatformFee = true,
): Promise<SwapQuote> {
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    slippageBps: String(request.slippageBps),
    restrictIntermediateTokens: "true",
  });
  if (includePlatformFee) {
    params.set("platformFeeBps", String(PLATFORM_FEE_BPS));
  }

  const url = `${JUPITER_BASE_URL}/swap/v1/quote?${params}`;
  const res = await fetchWithTimeout(url, {
    headers: { "x-api-key": apiKey },
  }, "Jupiter API");

  if (!res.ok) {
    if (res.status === 429) throw new Error("Jupiter API rate limited. Wait a moment and try again.");
    throw new Error(`Jupiter quote failed (${res.status}). Try again.`);
  }

  const raw = (await res.json()) as JupiterQuoteResponse;

  const routePlan: RouteStep[] = raw.routePlan.map((step) => ({
    ammLabel: step.swapInfo.label ?? "Unknown",
    inputMint: step.swapInfo.inputMint,
    outputMint: step.swapInfo.outputMint,
    inAmount: step.swapInfo.inAmount,
    outAmount: step.swapInfo.outAmount,
    percent: step.percent,
  }));

  return {
    inputMint: raw.inputMint,
    outputMint: raw.outputMint,
    inAmount: raw.inAmount,
    outAmount: raw.outAmount,
    otherAmountThreshold: raw.otherAmountThreshold,
    slippageBps: raw.slippageBps,
    priceImpactPct: raw.priceImpactPct,
    routePlan,
    rawQuoteResponse: raw,
  };
}

/**
 * Build a swap transaction from a quote via Jupiter Metis API.
 * Returns the base64-encoded unsigned transaction.
 */
async function buildSwapTransaction(
  quote: SwapQuote,
  userPublicKey: string,
  apiKey: string,
  feeAccount: string | null,
): Promise<JupiterSwapResponse> {
  const url = `${JUPITER_BASE_URL}/swap/v1/swap`;

  const body: Record<string, unknown> = {
    quoteResponse: quote.rawQuoteResponse,
    userPublicKey,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        priorityLevel: "veryHigh",
        maxLamports: MAX_PRIORITY_FEE_LAMPORTS,
      },
    },
  };

  if (feeAccount) {
    body.feeAccount = feeAccount;
  }

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: jupiterHeaders(apiKey),
    body: JSON.stringify(body),
  }, "Jupiter API");

  if (!res.ok) {
    if (res.status === 429) throw new Error("Jupiter API rate limited. Wait a moment and try again.");
    throw new Error(`Failed to build swap transaction (${res.status}). Try again.`);
  }

  return (await res.json()) as JupiterSwapResponse;
}

/**
 * Decode a base64-encoded transaction, sign it locally, and return the
 * base64-encoded signed transaction ready for sending.
 */
async function signSwapTransaction(
  base64Transaction: string,
  signer: KeyPairSigner,
): Promise<Base64EncodedWireTransaction> {
  const decoder = getTransactionDecoder();
  const txBytes = new Uint8Array(Buffer.from(base64Transaction, "base64"));
  const transaction = decoder.decode(txBytes);

  const signed = await signTransaction([signer.keyPair], transaction);
  return getBase64EncodedWireTransaction(signed);
}

/**
 * Send a signed transaction and poll for confirmation.
 * Returns the transaction signature on success.
 */
async function sendAndConfirm(
  rpc: Rpc<SolanaRpcApi>,
  signedBase64: Base64EncodedWireTransaction,
  lastValidBlockHeight: number,
): Promise<string> {
  // Send transaction — must specify base64 encoding to match getBase64EncodedWireTransaction output.
  const signature = await rpc
    .sendTransaction(signedBase64, {
      encoding: "base64",
      skipPreflight: true,
    })
    .send();

  // Poll for confirmation.
  const startTime = Date.now();

  while (Date.now() - startTime < CONFIRMATION_TIMEOUT_MS) {
    const blockHeight = await rpc.getBlockHeight().send();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error(
        "Transaction expired before confirmation. " +
        "The swap was not executed. Try again.",
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

  throw new Error(
    `Transaction confirmation timed out. Check status manually: ${signature}`,
  );
}

/**
 * Execute a full swap: quote → build → sign → send → confirm.
 * Returns a structured result with success/failure and transaction details.
 */
export async function executeSwap(
  quote: SwapQuote,
  signer: KeyPairSigner,
  rpc: Rpc<SolanaRpcApi>,
  apiKey: string,
  onStatus?: (status: string) => void,
): Promise<SwapResult> {
  let currentStep = "resolving fee account";
  try {
    const feeAccount = await resolveFeeAccount(rpc, quote.outputMint);

    // If no fee account available but quote included platform fee, re-quote without it.
    let activeQuote = quote;
    if (!feeAccount) {
      currentStep = "re-quoting without fee";
      activeQuote = await getSwapQuote(
        {
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          amount: quote.inAmount,
          slippageBps: quote.slippageBps,
        },
        apiKey,
        false,
      );
    }

    currentStep = "building transaction";
    onStatus?.("Building transaction...");
    const swapResponse = await buildSwapTransaction(
      activeQuote,
      signer.address,
      apiKey,
      feeAccount,
    );

    currentStep = "signing transaction";
    onStatus?.("Signing transaction...");
    const signedBase64 = await signSwapTransaction(
      swapResponse.swapTransaction,
      signer,
    );

    currentStep = "sending transaction";
    onStatus?.("Broadcasting transaction...");
    const signature = await sendAndConfirm(
      rpc,
      signedBase64,
      swapResponse.lastValidBlockHeight,
    );

    return {
      success: true,
      signature,
      inputMint: activeQuote.inputMint,
      outputMint: activeQuote.outputMint,
      inAmount: activeQuote.inAmount,
      outAmount: activeQuote.outAmount,
      error: null,
    };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    const message = `Failed while ${currentStep}: ${raw}`;
    return {
      success: false,
      signature: null,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      error: message,
    };
  }
}
