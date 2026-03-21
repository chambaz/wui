/** Default timeout for outbound fetch requests (15 seconds). */
const FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  url: string | URL,
  init?: RequestInit,
  serviceName = "remote service",
): Promise<Response> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`Request to ${serviceName} timed out. Try again.`);
    }
    throw new Error(`Could not reach ${serviceName}. Check your network connection.`);
  }
}

export function formatTransactionError(err: unknown): string {
  if (!err || typeof err !== "object") return "Unknown transaction error";

  const obj = err as Record<string, unknown>;
  if ("InstructionError" in obj && Array.isArray(obj.InstructionError)) {
    const [, reason] = obj.InstructionError as [number, unknown];
    if (typeof reason === "string") {
      return formatInstructionReason(reason);
    }
    if (reason && typeof reason === "object" && "Custom" in (reason as Record<string, unknown>)) {
      const code = (reason as Record<string, unknown>).Custom;
      return formatCustomError(Number(code));
    }
    return `Transaction failed (instruction error: ${JSON.stringify(reason)})`;
  }

  return `Transaction failed: ${JSON.stringify(err, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`;
}

function formatInstructionReason(reason: string): string {
  switch (reason) {
    case "InsufficientFunds":
      return "Insufficient balance for this transaction.";
    case "AccountNotFound":
      return "A required account was not found on-chain.";
    case "InvalidAccountData":
      return "An account contains invalid data.";
    case "AccountAlreadyInitialized":
      return "Token account already exists.";
    default:
      return `Transaction failed: ${reason}`;
  }
}

function formatCustomError(code: number): string {
  if (code === 6001) {
    return "Slippage tolerance exceeded. The price moved too much — try again or increase slippage.";
  }
  if (code === 6000) {
    return "Swap route expired. Try again.";
  }
  if (code === 1) return "Insufficient token balance.";
  return `Transaction failed (program error code: ${code})`;
}
