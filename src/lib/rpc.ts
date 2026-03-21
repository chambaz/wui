import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";

let instance: Rpc<SolanaRpcApi> | null = null;

export function initRpc(url: string): Rpc<SolanaRpcApi> {
  instance = createSolanaRpc(url);
  return instance;
}

export function getRpc(): Rpc<SolanaRpcApi> {
  if (!instance) {
    throw new Error("RPC not initialized. Call initRpc() first.");
  }
  return instance;
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
