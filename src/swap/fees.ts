import { type Rpc, type SolanaRpcApi, address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { ATA_PROGRAM, FEE_WALLET_ADDRESS, TOKEN_PROGRAM } from "./constants.js";

async function deriveFeeTokenAccount(mint: string): Promise<string> {
  const encoder = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [
      encoder.encode(address(FEE_WALLET_ADDRESS)),
      encoder.encode(address(TOKEN_PROGRAM)),
      encoder.encode(address(mint)),
    ],
  });
  return ata;
}

async function feeAccountExists(rpc: Rpc<SolanaRpcApi>, accountAddress: string): Promise<boolean> {
  try {
    const info = await rpc
      .getAccountInfo(address(accountAddress), {
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
      })
      .send();
    return info.value !== null;
  } catch {
    return false;
  }
}

export async function resolveFeeAccount(
  rpc: Rpc<SolanaRpcApi>,
  outputMint: string,
): Promise<string | null> {
  if (FEE_WALLET_ADDRESS.startsWith("TODO")) return null;
  try {
    const ata = await deriveFeeTokenAccount(outputMint);
    const exists = await feeAccountExists(rpc, ata);
    return exists ? ata : null;
  } catch {
    return null;
  }
}
