import { address, type Rpc, type SolanaRpcApi } from "@solana/kit";

import {
  DEFAULT_LEDGER_ACCOUNT_COUNT,
  DEFAULT_LEDGER_ACCOUNT_PATH_PREFIX,
  LAMPORTS_PER_SOL,
} from "./constants.js";
import { awaitLedgerDeviceAction } from "./device-actions.js";
import { formatLedgerError } from "./errors.js";
import { withLedgerSession } from "./session.js";
import type { LedgerAccountCandidate, LedgerDiscoveryOptions } from "./types.js";

function getDefaultLedgerAccountIndices(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function getLedgerSdkDerivationPath(accountIndex: number): string {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error("Ledger account index must be a non-negative integer.");
  }

  return `${DEFAULT_LEDGER_ACCOUNT_PATH_PREFIX}/${accountIndex}'/0'`;
}

async function fetchSolBalance(rpc: Rpc<SolanaRpcApi> | undefined, publicKey: string): Promise<number | null> {
  if (!rpc) {
    return null;
  }

  try {
    const { value: lamports } = await rpc.getBalance(address(publicKey)).send();
    return Number(lamports) / LAMPORTS_PER_SOL;
  } catch {
    return null;
  }
}

export async function discoverLedgerAccounts(options: LedgerDiscoveryOptions = {}): Promise<LedgerAccountCandidate[]> {
  const accountIndices = options.accountIndices ?? getDefaultLedgerAccountIndices(DEFAULT_LEDGER_ACCOUNT_COUNT);

  return await withLedgerSession(async ({ connectedDevice, signer }) => {
    const accounts: LedgerAccountCandidate[] = [];
    for (const accountIndex of accountIndices) {
      options.onStatus?.(`Loading account ${accountIndex}...`);
      const publicKey = await awaitLedgerDeviceAction(
        signer.getAddress(getLedgerSdkDerivationPath(accountIndex), { checkOnDevice: false, skipOpenApp: false }),
        options.onStatus,
      );
      const balanceSol = await fetchSolBalance(options.rpc, publicKey);

      accounts.push({
        publicKey,
        accountIndex,
        balanceSol,
        device: {
          name: connectedDevice.name,
          modelId: connectedDevice.modelId,
        },
      });
    }

    return accounts;
  }, options.onStatus).catch((error: unknown) => {
    throw formatLedgerError(error, "Failed to discover Ledger accounts.");
  });
}

export async function verifyLedgerAddress(
  accountIndex: number,
  expectedPublicKey?: string,
  onStatus?: (status: string) => void,
): Promise<string> {
  const derivationPath = getLedgerSdkDerivationPath(accountIndex);

  return await withLedgerSession(async ({ signer }) => {
    const publicKey = await awaitLedgerDeviceAction(
      signer.getAddress(derivationPath, { checkOnDevice: true, skipOpenApp: false }),
      onStatus,
    );

    if (expectedPublicKey && publicKey !== expectedPublicKey) {
      throw new Error("Ledger returned a different address than the saved wallet entry.");
    }

    return publicKey;
  }, onStatus).catch((error: unknown) => {
    throw formatLedgerError(error, "Failed to verify Ledger address.");
  });
}
