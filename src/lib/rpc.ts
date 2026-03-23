import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";

export function initRpc(url: string): Rpc<SolanaRpcApi> {
  return createSolanaRpc(url);
}

/** Ping the RPC with a lightweight call to verify connectivity. */
export async function checkRpcHealth(rpc: Rpc<SolanaRpcApi>): Promise<boolean> {
  try {
    await rpc.getSlot().send();
    return true;
  } catch {
    return false;
  }
}
