export interface WalletEntry {
  id: string;
  label: string;
  publicKey: string;
  keyfilePath: string;
  isActive: boolean;
  storageType: "encrypted";
}

export interface WalletStore {
  wallets: WalletEntry[];
}
