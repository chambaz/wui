import {
  type Base64EncodedWireTransaction,
  type KeyPairSigner,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionMessageWithLifetime,
} from "@solana/kit";
import type { WalletEntry } from "../types/wallet.js";

export type TransactionMessageForSigning =
  TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithLifetime;
export type AdditionalTransactionSigner = KeyPairSigner;

export interface WalletCapabilities {
  supportsTransactionSigning: boolean;
  supportsAddressVerification: boolean;
  supportsMessageSigning: boolean;
  supportsBlindSigning: boolean;
  supportsVersionedTransactions: boolean;
  supportsClearSigningTransfers: boolean;
  supportsClearSigningSwaps: boolean;
}

export interface WalletProvider {
  entry: WalletEntry;
  publicKey: string;
  label: string;
  kind: WalletEntry["kind"];
  capabilities: WalletCapabilities;
  ensureReady(): Promise<void>;
  verifyAddressOnDevice?(): Promise<void>;
  getTransactionSigner(): Promise<AdditionalTransactionSigner | null>;
  signTransactionMessage<TTransactionMessage extends TransactionMessageForSigning>(
    transactionMessage: TTransactionMessage,
    additionalSigners?: readonly AdditionalTransactionSigner[],
  ): Promise<Base64EncodedWireTransaction>;
  signTransactionBytes(transactionBytes: Uint8Array): Promise<Base64EncodedWireTransaction>;
}
