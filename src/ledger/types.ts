import type { ConnectedDevice } from "@ledgerhq/device-management-kit";
import type { SignerSolana } from "@ledgerhq/device-signer-kit-solana";
import type { Rpc, SolanaRpcApi } from "@solana/kit";

export interface LedgerDeviceDetails {
  name: string;
  modelId: string;
}

export interface LedgerAccountCandidate {
  publicKey: string;
  accountIndex: number;
  balanceSol: number | null;
  device: LedgerDeviceDetails;
}

export interface LedgerDiscoveryOptions {
  accountIndices?: number[];
  rpc?: Rpc<SolanaRpcApi>;
  onStatus?: (status: string) => void;
}

export interface LedgerSessionContext {
  connectedDevice: ConnectedDevice;
  signer: SignerSolana;
}
