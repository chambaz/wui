import { formatAmount, parseDecimalAmount } from "../lib/format.js";
import type { WrapRequest } from "../types/wrap.js";
import { executeWrapAction, getMaxWrappableLamports, getWrapAvailability } from "../wrap/index.js";
import { bootstrap, getCliActiveSigner, printJson } from "./index.js";

function getUnwrapAvailabilityErrorMessage(extraWrappedSolRawBalance: bigint): string {
  if (extraWrappedSolRawBalance > 0n) {
    return "Unwrap here only supports the standard Wrapped SOL account. This wallet's Wrapped SOL is held in a different token account.";
  }

  return "No standard Wrapped SOL account found.";
}

export async function wrapCommand(args: string[], json: boolean): Promise<void> {
  const amountArg = args[0]?.trim();
  if (!amountArg) {
    throw new Error("Usage: wui wrap <amount|max>");
  }

  const { rpc, wallet } = await bootstrap();
  const availability = await getWrapAvailability(rpc, wallet.publicKey);

  const amount = amountArg === "max"
    ? getMaxWrappableLamports(availability)
    : parseDecimalAmount(amountArg, 9);

  if (amount === null || amount <= 0n) {
    throw new Error("Amount must be greater than 0.");
  }

  const maxWrappableLamports = getMaxWrappableLamports(availability);
  if (amount > maxWrappableLamports) {
    throw new Error("Amount exceeds the available SOL after reserve requirements.");
  }

  const signer = await getCliActiveSigner(json);
  const request: WrapRequest = {
    action: "wrap",
    amount,
  };

  if (!json) {
    console.log(`Wrapping ${formatAmount(String(amount), 9)} SOL...`);
  }

  const result = await executeWrapAction(request, signer, rpc, json ? undefined : (status) => console.log(status));

  if (json) {
    printJson(result);
    return;
  }

  if (!result.success) {
    throw new Error(result.error ?? "Wrap failed.");
  }

  console.log(`Wrap successful! Tx: ${result.signature}`);
}

export async function unwrapCommand(json: boolean): Promise<void> {
  const { rpc, wallet } = await bootstrap();
  const availability = await getWrapAvailability(rpc, wallet.publicKey);

  if (!availability.wrappedSolAccountExists) {
    throw new Error(getUnwrapAvailabilityErrorMessage(availability.extraWrappedSolRawBalance));
  }

  if (availability.wrappedSolRawBalance <= 0n) {
    throw new Error("No Wrapped SOL available in the standard account.");
  }

  const signer = await getCliActiveSigner(json);
  const request: WrapRequest = {
    action: "unwrap",
    amount: availability.wrappedSolRawBalance,
  };

  if (!json) {
    console.log(`Unwrapping ${formatAmount(String(availability.wrappedSolRawBalance), 9)} SOL...`);
  }

  const result = await executeWrapAction(request, signer, rpc, json ? undefined : (status) => console.log(status));

  if (json) {
    printJson(result);
    return;
  }

  if (!result.success) {
    throw new Error(result.error ?? "Unwrap failed.");
  }

  console.log(`Unwrap successful! Tx: ${result.signature}`);
}
