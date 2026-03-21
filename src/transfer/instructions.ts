import { address, AccountRole, getU32Encoder, getU64Encoder, getU8Encoder, getStructEncoder } from "@solana/kit";
import { SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./constants.js";

const systemTransferEncoder = getStructEncoder([
  ["instruction", getU32Encoder()],
  ["lamports", getU64Encoder()],
]);

const tokenTransferCheckedEncoder = getStructEncoder([
  ["instruction", getU8Encoder()],
  ["amount", getU64Encoder()],
  ["decimals", getU8Encoder()],
]);

export function buildSolTransferInstruction(from: string, to: string, lamports: bigint) {
  return {
    programAddress: address(SYSTEM_PROGRAM),
    accounts: [
      { address: address(from), role: AccountRole.WRITABLE_SIGNER },
      { address: address(to), role: AccountRole.WRITABLE },
    ],
    data: systemTransferEncoder.encode({ instruction: 2, lamports }),
  };
}

export function buildTokenTransferInstruction(
  sourceAta: string,
  destAta: string,
  owner: string,
  mint: string,
  amount: bigint,
  decimals: number,
  tokenProgram: string = TOKEN_PROGRAM,
) {
  return {
    programAddress: address(tokenProgram),
    accounts: [
      { address: address(sourceAta), role: AccountRole.WRITABLE },
      { address: address(mint), role: AccountRole.READONLY },
      { address: address(destAta), role: AccountRole.WRITABLE },
      { address: address(owner), role: AccountRole.WRITABLE_SIGNER },
    ],
    data: tokenTransferCheckedEncoder.encode({ instruction: 12, amount, decimals }),
  };
}
