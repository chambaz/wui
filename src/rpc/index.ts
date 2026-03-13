import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";

let rpc: Rpc<SolanaRpcApi> | null = null;

export function initRpc(rpcUrl: string): Rpc<SolanaRpcApi> {
  rpc = createSolanaRpc(rpcUrl);
  return rpc;
}

export function getRpc(): Rpc<SolanaRpcApi> {
  if (!rpc) {
    throw new Error("RPC not initialized. Call initRpc() first.");
  }
  return rpc;
}

export async function checkRpcHealth(rpc: Rpc<SolanaRpcApi>): Promise<boolean> {
  try {
    await rpc.getSlot().send();
    return true;
  } catch {
    return false;
  }
}
