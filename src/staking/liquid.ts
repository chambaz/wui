import {
  type Rpc,
  type SolanaRpcApi,
  type KeyPairSigner,
  address,
  getAddressEncoder,
  getAddressDecoder,
  getProgramDerivedAddress,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  addSignersToTransactionMessage,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  AccountRole,
  getU8Encoder,
  getU64Encoder,
  getStructEncoder,
} from "@solana/kit";
import { ATA_PROGRAM, STAKE_POOL_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./constants.js";
import { sendAndConfirm } from "./confirm.js";

async function getAssociatedTokenAddress(owner: string, mint: string): Promise<string> {
  const encoder = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [
      encoder.encode(address(owner)),
      encoder.encode(address(TOKEN_PROGRAM)),
      encoder.encode(address(mint)),
    ],
  });
  return ata;
}

async function accountExists(rpc: Rpc<SolanaRpcApi>, addr: string): Promise<boolean> {
  try {
    const info = await rpc
      .getAccountInfo(address(addr), { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
      .send();
    return info.value !== null;
  } catch {
    return false;
  }
}

function buildCreateAtaInstruction(payer: string, ataAddress: string, owner: string, mint: string) {
  return {
    programAddress: address(ATA_PROGRAM),
    accounts: [
      { address: address(payer), role: AccountRole.WRITABLE_SIGNER },
      { address: address(ataAddress), role: AccountRole.WRITABLE },
      { address: address(owner), role: AccountRole.READONLY },
      { address: address(mint), role: AccountRole.READONLY },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
    ],
    data: new Uint8Array(0),
  };
}

function decodeAddressFromBytes(bytes: Uint8Array): string {
  const decoder = getAddressDecoder();
  return decoder.decode(bytes);
}

export async function depositToStakePool(
  rpc: Rpc<SolanaRpcApi>,
  signer: KeyPairSigner,
  stakePoolAddress: string,
  lamports: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Fetching pool data...");

  const poolInfo = await rpc.getAccountInfo(address(stakePoolAddress), { encoding: "base64" }).send();
  if (!poolInfo.value) throw new Error("Stake pool account not found.");

  const poolData = new Uint8Array(Buffer.from(poolInfo.value.data[0], "base64"));
  const reserveStake = decodeAddressFromBytes(poolData.slice(130, 162));
  const poolMint = decodeAddressFromBytes(poolData.slice(162, 194));
  const managerFeeAccount = decodeAddressFromBytes(poolData.slice(194, 226));

  const encoder = getAddressEncoder();
  const [withdrawAuthority] = await getProgramDerivedAddress({
    programAddress: address(STAKE_POOL_PROGRAM),
    seeds: [encoder.encode(address(stakePoolAddress)), new TextEncoder().encode("withdraw")],
  });

  const userLstAta = await getAssociatedTokenAddress(signer.address, poolMint);
  const lstAtaExists = await accountExists(rpc, userLstAta);

  onStatus?.("Building transaction...");
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const depositSolEncoder = getStructEncoder([
    ["instruction", getU8Encoder()],
    ["lamports", getU64Encoder()],
  ] as const);

  const depositSolIx = {
    programAddress: address(STAKE_POOL_PROGRAM),
    accounts: [
      { address: address(stakePoolAddress), role: AccountRole.WRITABLE },
      { address: address(withdrawAuthority), role: AccountRole.READONLY },
      { address: address(reserveStake), role: AccountRole.WRITABLE },
      { address: address(signer.address), role: AccountRole.WRITABLE_SIGNER },
      { address: address(userLstAta), role: AccountRole.WRITABLE },
      { address: address(managerFeeAccount), role: AccountRole.WRITABLE },
      { address: address(managerFeeAccount), role: AccountRole.WRITABLE },
      { address: address(poolMint), role: AccountRole.WRITABLE },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
    ],
    data: depositSolEncoder.encode({ instruction: 14, lamports }),
  };

  const baseMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(address(signer.address), msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => addSignersToTransactionMessage([signer], msg),
  );

  let txMessage;
  if (!lstAtaExists) {
    const createAtaIx = buildCreateAtaInstruction(signer.address, userLstAta, signer.address, poolMint);
    txMessage = pipe(
      baseMessage,
      (msg) => appendTransactionMessageInstruction(createAtaIx, msg),
      (msg) => appendTransactionMessageInstruction(depositSolIx, msg),
    );
  } else {
    txMessage = appendTransactionMessageInstruction(depositSolIx, baseMessage);
  }

  onStatus?.("Signing transaction...");
  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const encoded = getBase64EncodedWireTransaction(signedTx);

  onStatus?.("Broadcasting transaction...");
  return sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);
}
