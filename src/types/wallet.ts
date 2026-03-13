export interface WalletEntry {
  label: string;
  publicKey: string;
  keypairPath: string;
  isActive: boolean;
}

export interface WalletStore {
  wallets: WalletEntry[];
}
