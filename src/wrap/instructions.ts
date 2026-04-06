import { address, AccountRole, getU8Encoder } from "@solana/kit";
import { TOKEN_PROGRAM } from "../transfer/constants.js";

const instructionEncoder = getU8Encoder();

export function buildSyncNativeInstruction(
  accountAddress: string,
  tokenProgram: string = TOKEN_PROGRAM,
) {
  return {
    programAddress: address(tokenProgram),
    accounts: [
      { address: address(accountAddress), role: AccountRole.WRITABLE },
    ],
    data: instructionEncoder.encode(17),
  };
}

export function buildCloseAccountInstruction(
  accountAddress: string,
  destinationAddress: string,
  ownerAddress: string,
  tokenProgram: string = TOKEN_PROGRAM,
) {
  return {
    programAddress: address(tokenProgram),
    accounts: [
      { address: address(accountAddress), role: AccountRole.WRITABLE },
      { address: address(destinationAddress), role: AccountRole.WRITABLE },
      { address: address(ownerAddress), role: AccountRole.READONLY_SIGNER },
    ],
    data: instructionEncoder.encode(9),
  };
}
