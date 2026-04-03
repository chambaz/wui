export interface BaseWalletEntry {
  id: string;
  label: string;
  publicKey: string;
  isActive: boolean;
  kind: "software" | "hardware";
}

export interface EncryptedSoftwareWalletEntry extends BaseWalletEntry {
  kind: "software";
  storageType: "encrypted";
  keyfilePath: string;
}

export interface HardwareWalletEntry extends BaseWalletEntry {
  kind: "hardware";
  vendor: string;
  derivationPath: string;
  deviceModel?: string;
  deviceName?: string;
}

export type WalletEntry = EncryptedSoftwareWalletEntry | HardwareWalletEntry;

export interface WalletStore {
  wallets: WalletEntry[];
}

export function isSoftwareWalletEntry(wallet: WalletEntry): wallet is EncryptedSoftwareWalletEntry {
  return wallet.kind === "software";
}

export function isHardwareWalletEntry(wallet: WalletEntry): wallet is HardwareWalletEntry {
  return wallet.kind === "hardware";
}
