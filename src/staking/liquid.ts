import {
  type Rpc,
  type SolanaRpcApi,
  address,
  generateKeyPairSigner,
  getAddressEncoder,
  getAddressDecoder,
  getProgramDerivedAddress,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  AccountRole,
  getU8Encoder,
  getU64Encoder,
  getStructEncoder,
} from "@solana/kit";
import type { WalletProvider } from "../wallet/provider.js";
import { ATA_PROGRAM, STAKE_POOL_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./constants.js";
import { sendAndConfirm } from "./confirm.js";

interface StakePoolInfo {
  reserveStake: string;
  poolMint: string;
  managerFeeAccount: string;
  solDepositAuthority: string | null;
  solWithdrawAuthority: string | null;
}

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
  const info = await rpc
    .getAccountInfo(address(addr), { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
    .send();
  return info.value !== null;
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

function buildApproveInstruction(source: string, delegate: string, owner: string, amount: bigint) {
  const approveEncoder = getStructEncoder([
    ["instruction", getU8Encoder()],
    ["amount", getU64Encoder()],
  ] as const);

  return {
    programAddress: address(TOKEN_PROGRAM),
    accounts: [
      { address: address(source), role: AccountRole.WRITABLE },
      { address: address(delegate), role: AccountRole.READONLY },
      { address: address(owner), role: AccountRole.READONLY_SIGNER },
    ],
    data: approveEncoder.encode({ instruction: 4, amount }),
  };
}

function decodeAddressFromBytes(bytes: Uint8Array): string {
  const decoder = getAddressDecoder();
  return decoder.decode(bytes);
}

function readOptionalAddress(poolData: Uint8Array, offset: number): { value: string | null; nextOffset: number } {
  const discriminator = poolData[offset];
  if (discriminator === 0) {
    return { value: null, nextOffset: offset + 1 };
  }

  if (discriminator === 1) {
    const start = offset + 1;
    const end = start + 32;
    return { value: decodeAddressFromBytes(poolData.slice(start, end)), nextOffset: end };
  }

  throw new Error("Invalid optional address in stake pool account.");
}

function skipFutureEpoch(poolData: Uint8Array, offset: number, span: number): number {
  const discriminator = poolData[offset];
  if (discriminator === 0) {
    return offset + 1;
  }

  if (discriminator === 2) {
    return offset + 1 + span;
  }

  throw new Error("Invalid future epoch field in stake pool account.");
}

function decodeStakePoolInfo(poolData: Uint8Array): StakePoolInfo {
  if (poolData.length < 226) {
    throw new Error("Invalid stake pool account.");
  }

  let cursor = 226;
  cursor += 32; // tokenProgramId
  cursor += 8; // totalLamports
  cursor += 8; // poolTokenSupply
  cursor += 8; // lastUpdateEpoch
  cursor += 48; // lockup
  cursor += 16; // epochFee
  cursor = skipFutureEpoch(poolData, cursor, 16);
  cursor = readOptionalAddress(poolData, cursor).nextOffset;
  cursor = readOptionalAddress(poolData, cursor).nextOffset;
  cursor += 16; // stakeDepositFee
  cursor += 16; // stakeWithdrawalFee
  cursor = skipFutureEpoch(poolData, cursor, 16);
  cursor += 1; // stakeReferralFee
  const solDepositAuthorityResult = readOptionalAddress(poolData, cursor);
  cursor = solDepositAuthorityResult.nextOffset;
  cursor += 16; // solDepositFee
  cursor += 1; // solReferralFee
  const solWithdrawAuthority = readOptionalAddress(poolData, cursor).value;

  return {
    reserveStake: decodeAddressFromBytes(poolData.slice(130, 162)),
    poolMint: decodeAddressFromBytes(poolData.slice(162, 194)),
    managerFeeAccount: decodeAddressFromBytes(poolData.slice(194, 226)),
    solDepositAuthority: solDepositAuthorityResult.value,
    solWithdrawAuthority,
  };
}

export async function fetchStakePoolInfo(
  rpc: Rpc<SolanaRpcApi>,
  stakePoolAddress: string,
): Promise<StakePoolInfo> {
  const poolInfo = await rpc.getAccountInfo(address(stakePoolAddress), { encoding: "base64" }).send();
  if (!poolInfo.value) {
    throw new Error("Stake pool account not found.");
  }

  if (poolInfo.value.owner !== STAKE_POOL_PROGRAM) {
    throw new Error("Account is not an SPL stake pool.");
  }

  const poolData = new Uint8Array(Buffer.from(poolInfo.value.data[0], "base64"));
  const decoded = decodeStakePoolInfo(poolData);
  if (decoded.solDepositAuthority) {
    throw new Error("Stake pool requires a SOL deposit authority and is not supported.");
  }
  if (decoded.solWithdrawAuthority) {
    throw new Error("Stake pool requires a SOL withdraw authority and is not supported.");
  }

  return decoded;
}

export async function depositToStakePool(
  rpc: Rpc<SolanaRpcApi>,
  provider: WalletProvider,
  stakePoolAddress: string,
  lamports: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Fetching pool data...");

  const { reserveStake, poolMint, managerFeeAccount } = await fetchStakePoolInfo(rpc, stakePoolAddress);

  const encoder = getAddressEncoder();
  const [withdrawAuthority] = await getProgramDerivedAddress({
    programAddress: address(STAKE_POOL_PROGRAM),
    seeds: [encoder.encode(address(stakePoolAddress)), new TextEncoder().encode("withdraw")],
  });

  const userLstAta = await getAssociatedTokenAddress(provider.publicKey, poolMint);
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
      { address: address(provider.publicKey), role: AccountRole.WRITABLE_SIGNER },
      { address: address(userLstAta), role: AccountRole.WRITABLE },
      { address: address(managerFeeAccount), role: AccountRole.WRITABLE },
      { address: address(userLstAta), role: AccountRole.WRITABLE },
      { address: address(poolMint), role: AccountRole.WRITABLE },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
    ],
    data: depositSolEncoder.encode({ instruction: 14, lamports }),
  };

  const baseMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(address(provider.publicKey), msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
  );

  let txMessage;
  if (!lstAtaExists) {
    const createAtaIx = buildCreateAtaInstruction(provider.publicKey, userLstAta, provider.publicKey, poolMint);
    txMessage = pipe(
      baseMessage,
      (msg) => appendTransactionMessageInstruction(createAtaIx, msg),
      (msg) => appendTransactionMessageInstruction(depositSolIx, msg),
    );
  } else {
    txMessage = appendTransactionMessageInstruction(depositSolIx, baseMessage);
  }

  onStatus?.("Signing transaction...");
  const encoded = await provider.signTransactionMessage(txMessage);

  onStatus?.("Broadcasting transaction...");
  return sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);
}

export async function withdrawSolFromStakePool(
  rpc: Rpc<SolanaRpcApi>,
  provider: WalletProvider,
  stakePoolAddress: string,
  poolTokens: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Fetching pool data...");

  const { reserveStake, poolMint, managerFeeAccount } = await fetchStakePoolInfo(rpc, stakePoolAddress);
  const userLstAta = await getAssociatedTokenAddress(provider.publicKey, poolMint);
  const lstAtaExists = await accountExists(rpc, userLstAta);
  if (!lstAtaExists) {
    throw new Error("LST token account not found for this stake pool.");
  }

  const encoder = getAddressEncoder();
  const [withdrawAuthority] = await getProgramDerivedAddress({
    programAddress: address(STAKE_POOL_PROGRAM),
    seeds: [encoder.encode(address(stakePoolAddress)), new TextEncoder().encode("withdraw")],
  });

  const transferAuthority = await generateKeyPairSigner();

  onStatus?.("Building transaction...");
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const withdrawSolEncoder = getStructEncoder([
    ["instruction", getU8Encoder()],
    ["poolTokens", getU64Encoder()],
  ] as const);

  const approveIx = buildApproveInstruction(userLstAta, transferAuthority.address, provider.publicKey, poolTokens);
  const withdrawSolIx = {
    programAddress: address(STAKE_POOL_PROGRAM),
    accounts: [
      { address: address(stakePoolAddress), role: AccountRole.WRITABLE },
      { address: address(withdrawAuthority), role: AccountRole.READONLY },
      { address: address(transferAuthority.address), role: AccountRole.READONLY_SIGNER },
      { address: address(userLstAta), role: AccountRole.WRITABLE },
      { address: address(reserveStake), role: AccountRole.WRITABLE },
      { address: address(provider.publicKey), role: AccountRole.WRITABLE },
      { address: address(managerFeeAccount), role: AccountRole.WRITABLE },
      { address: address(poolMint), role: AccountRole.WRITABLE },
      { address: address("SysvarC1ock11111111111111111111111111111111"), role: AccountRole.READONLY },
      { address: address("SysvarStakeHistory1111111111111111111111111"), role: AccountRole.READONLY },
      { address: address("Stake11111111111111111111111111111111111111"), role: AccountRole.READONLY },
      { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
    ],
    data: withdrawSolEncoder.encode({ instruction: 16, poolTokens }),
  };

  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(address(provider.publicKey), msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstruction(approveIx, msg),
    (msg) => appendTransactionMessageInstruction(withdrawSolIx, msg),
  );

  onStatus?.("Signing transaction...");
  const encoded = await provider.signTransactionMessage(txMessage, [transferAuthority]);

  onStatus?.("Broadcasting transaction...");
  return sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);
}
