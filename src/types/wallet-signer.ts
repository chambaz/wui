export interface WalletSigner {
  address: string;
  signTransactions: (transactions: readonly unknown[]) => Promise<readonly Record<string, Uint8Array>[]>;
}
