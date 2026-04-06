import type { ExecuteDeviceActionReturnType } from "@ledgerhq/device-management-kit";

import {
  LEDGER_DEVICE_ACTION_STATUS_COMPLETED,
  LEDGER_DEVICE_ACTION_STATUS_ERROR,
  LEDGER_DEVICE_ACTION_STATUS_PENDING,
  LEDGER_DEVICE_ACTION_STATUS_STOPPED,
  LEDGER_USER_INTERACTION_CONFIRM_OPEN_APP,
  LEDGER_USER_INTERACTION_NONE,
  LEDGER_USER_INTERACTION_SIGN_TRANSACTION,
  LEDGER_USER_INTERACTION_UNLOCK_DEVICE,
  LEDGER_USER_INTERACTION_VERIFY_ADDRESS,
} from "./constants.js";
import { formatLedgerError, LedgerActionError } from "./errors.js";

type PendingDeviceActionState<IntermediateValue> = {
  status: typeof LEDGER_DEVICE_ACTION_STATUS_PENDING;
  intermediateValue: IntermediateValue;
};

interface IntermediateLedgerValue {
  requiredUserInteraction?: string;
  step?: string;
}

function formatLedgerInteraction(intermediateValue: IntermediateLedgerValue): string {
  switch (intermediateValue.requiredUserInteraction) {
    case LEDGER_USER_INTERACTION_UNLOCK_DEVICE:
      return "Unlock your Ledger device...";
    case LEDGER_USER_INTERACTION_CONFIRM_OPEN_APP:
      return "Open the Solana app on your Ledger...";
    case LEDGER_USER_INTERACTION_VERIFY_ADDRESS:
      return "Verify the address on your Ledger...";
    case LEDGER_USER_INTERACTION_SIGN_TRANSACTION:
      return "Review and sign the transaction on your Ledger...";
    case LEDGER_USER_INTERACTION_NONE:
      break;
    default:
      break;
  }

  if (intermediateValue.step?.includes("openApp")) {
    return "Open the Solana app on your Ledger...";
  }

  if (intermediateValue.step?.includes("signTransaction")) {
    return "Review and sign the transaction on your Ledger...";
  }

  return "Waiting for Ledger device...";
}

export async function awaitLedgerDeviceAction<Output, Error, IntermediateValue extends IntermediateLedgerValue>(
  deviceAction: ExecuteDeviceActionReturnType<Output, Error, IntermediateValue>,
  onStatus?: (status: string) => void,
): Promise<Output> {
  return await new Promise<Output>((resolve, reject) => {
    const subscription = deviceAction.observable.subscribe({
      next(state) {
        switch (state.status) {
          case LEDGER_DEVICE_ACTION_STATUS_PENDING:
            onStatus?.(formatLedgerInteraction((state as PendingDeviceActionState<IntermediateValue>).intermediateValue));
            return;
          case LEDGER_DEVICE_ACTION_STATUS_COMPLETED:
            subscription.unsubscribe();
            resolve(state.output);
            return;
          case LEDGER_DEVICE_ACTION_STATUS_ERROR:
            subscription.unsubscribe();
            reject(formatLedgerError(state.error, "Ledger request failed."));
            return;
          case LEDGER_DEVICE_ACTION_STATUS_STOPPED:
            subscription.unsubscribe();
            reject(new LedgerActionError("Ledger request was cancelled."));
            return;
          default:
            return;
        }
      },
      error(error) {
        subscription.unsubscribe();
        reject(formatLedgerError(error, "Ledger request failed."));
      },
    });
  });
}
