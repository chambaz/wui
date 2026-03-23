import { type Rpc, type SolanaRpcApi, address } from "@solana/kit";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "./constants.js";

export async function getTokenProgramForMint(
  rpc: Rpc<SolanaRpcApi>,
  mint: string,
): Promise<string> {
  const info = await rpc
    .getAccountInfo(address(mint), { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
    .send();

  if (!info.value) {
    throw new Error(`Mint account not found: ${mint}`);
  }

  if (info.value?.owner === TOKEN_2022_PROGRAM) {
    return TOKEN_2022_PROGRAM;
  }

  if (info.value.owner === TOKEN_PROGRAM) {
    return TOKEN_PROGRAM;
  }

  throw new Error(`Unsupported mint owner for ${mint}: ${info.value.owner}`);
}
