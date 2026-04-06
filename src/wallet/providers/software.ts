import {
  addSignersToTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  signTransaction,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type { EncryptedSoftwareWalletEntry } from "../../types/wallet.js";
import type {
  AdditionalTransactionSigner,
  WalletCapabilities,
  WalletProvider,
  TransactionMessageForSigning,
} from "../provider.js";

const SOFTWARE_WALLET_CAPABILITIES: WalletCapabilities = {
  supportsTransactionSigning: true,
  supportsAddressVerification: false,
  supportsMessageSigning: false,
  supportsBlindSigning: true,
  supportsVersionedTransactions: true,
  supportsClearSigningTransfers: true,
  supportsClearSigningSwaps: true,
};

export function createSoftwareWalletProvider(
  entry: EncryptedSoftwareWalletEntry,
  signer: AdditionalTransactionSigner,
): WalletProvider {
  return {
    entry,
    publicKey: entry.publicKey,
    label: entry.label,
    kind: entry.kind,
    capabilities: SOFTWARE_WALLET_CAPABILITIES,
    async ensureReady(): Promise<void> {
      return;
    },
    async getTransactionSigner() {
      return signer;
    },
    async signTransactionMessage<TTransactionMessage extends TransactionMessageForSigning>(
      transactionMessage: TTransactionMessage,
      additionalSigners: readonly AdditionalTransactionSigner[] = [],
    ) {
      const messageWithSigners = addSignersToTransactionMessage([signer, ...additionalSigners], transactionMessage);
      const signedTransaction = await signTransactionMessageWithSigners(messageWithSigners);
      return getBase64EncodedWireTransaction(signedTransaction);
    },
    async signTransactionBytes(transactionBytes: Uint8Array) {
      const transaction = getTransactionDecoder().decode(transactionBytes);
      const signedTransaction = await signTransaction([signer.keyPair], transaction);
      return getBase64EncodedWireTransaction(signedTransaction);
    },
  };
}
