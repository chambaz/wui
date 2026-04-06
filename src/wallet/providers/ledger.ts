import type { HardwareWalletEntry } from "../../types/wallet.js";
import { verifyLedgerAddress } from "../../ledger/index.js";
import type { WalletCapabilities, WalletProvider } from "../provider.js";

const LEDGER_WALLET_CAPABILITIES: WalletCapabilities = {
  supportsTransactionSigning: false,
  supportsAddressVerification: true,
  supportsMessageSigning: false,
  supportsBlindSigning: false,
  supportsVersionedTransactions: true,
  supportsClearSigningTransfers: false,
  supportsClearSigningSwaps: false,
};

export function createLedgerWalletProvider(entry: HardwareWalletEntry): WalletProvider {
  return {
    entry,
    publicKey: entry.publicKey,
    label: entry.label,
    kind: entry.kind,
    capabilities: LEDGER_WALLET_CAPABILITIES,
    async ensureReady(): Promise<void> {
      await verifyLedgerAddress(entry.accountIndex, entry.publicKey);
    },
    async verifyAddressOnDevice(): Promise<void> {
      await verifyLedgerAddress(entry.accountIndex, entry.publicKey);
    },
    async getTransactionSigner() {
      return null;
    },
    async signTransactionMessage() {
      throw new Error("Ledger transaction signing is not implemented yet.");
    },
    async signTransactionBytes() {
      throw new Error("Ledger transaction signing is not implemented yet.");
    },
  };
}
