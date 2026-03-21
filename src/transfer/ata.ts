import { type Rpc, type SolanaRpcApi, address, AccountRole, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./constants.js";

export async function getAssociatedTokenAddress(
  owner: string,
  mint: string,
  tokenProgram: string = TOKEN_PROGRAM,
): Promise<string> {
  const addressEncoder = getAddressEncoder();
  const seeds = [
    addressEncoder.encode(address(owner)),
    addressEncoder.encode(address(tokenProgram)),
    addressEncoder.encode(address(mint)),
  ];
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds,
  });
  return ata;
}

export async function accountExists(
  rpc: Rpc<SolanaRpcApi>,
  accountAddress: string,
): Promise<boolean> {
  const info = await rpc
    .getAccountInfo(address(accountAddress), { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
    .send();
  return info.value !== null;
}

export function buildCreateAtaInstruction(
  payer: string,
  ataAddress: string,
  owner: string,
  mint: string,
  tokenProgram: string = TOKEN_PROGRAM,
) {
  return {
    programAddress: address(ATA_PROGRAM),
    accounts: [
      { address: address(payer), role: AccountRole.WRITABLE_SIGNER },
      { address: address(ataAddress), role: AccountRole.WRITABLE },
      { address: address(owner), role: AccountRole.READONLY },
      { address: address(mint), role: AccountRole.READONLY },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: address(tokenProgram), role: AccountRole.READONLY },
    ],
    data: new Uint8Array(0),
  };
}
