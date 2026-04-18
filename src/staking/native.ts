import {
  type Rpc,
  type SolanaRpcApi,
  address,
  generateKeyPairSigner,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  addSignersToTransactionMessage,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import {
  getInitializeInstruction,
  getDelegateStakeInstruction,
  getDeactivateInstruction,
  getWithdrawInstruction,
} from "@solana-program/stake";
import { getCreateAccountInstruction } from "@solana-program/system";
import type { WalletSigner } from "../types/wallet-signer.js";
import { STAKE_ACCOUNT_SIZE, SYSTEM_PROGRAM } from "./constants.js";
import { sendAndConfirm } from "./confirm.js";

export async function createNativeStake(
  rpc: Rpc<SolanaRpcApi>,
  signer: WalletSigner,
  validatorVoteAccount: string,
  lamports: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Building transaction...");
  const stakeAccountSigner = await generateKeyPairSigner();
  const rentExempt = await rpc.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE).send();
  const totalLamports = lamports + rentExempt;
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const createAccountIx = getCreateAccountInstruction({
    payer: signer,
    newAccount: stakeAccountSigner,
    lamports: totalLamports,
    space: STAKE_ACCOUNT_SIZE,
    programAddress: address("Stake11111111111111111111111111111111111111"),
  });

  const initializeIx = getInitializeInstruction({
    stake: address(stakeAccountSigner.address),
    arg0: { staker: address(signer.address), withdrawer: address(signer.address) },
    arg1: { unixTimestamp: 0n as never, epoch: 0n as never, custodian: address(SYSTEM_PROGRAM) },
  });

  const delegateIx = getDelegateStakeInstruction({
    stake: address(stakeAccountSigner.address),
    vote: address(validatorVoteAccount),
    unused: address(SYSTEM_PROGRAM),
    stakeAuthority: signer,
  });

  onStatus?.("Signing transaction...");
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(address(signer.address), msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => addSignersToTransactionMessage([signer, stakeAccountSigner], msg),
    (msg) => appendTransactionMessageInstruction(createAccountIx, msg),
    (msg) => appendTransactionMessageInstruction(initializeIx, msg),
    (msg) => appendTransactionMessageInstruction(delegateIx, msg),
  );

  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const encoded = getBase64EncodedWireTransaction(signedTx);
  onStatus?.("Broadcasting transaction...");
  return sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);
}

export async function deactivateStake(
  rpc: Rpc<SolanaRpcApi>,
  signer: WalletSigner,
  stakeAccountAddress: string,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Building transaction...");
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const deactivateIx = getDeactivateInstruction({ stake: address(stakeAccountAddress), stakeAuthority: signer });
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(address(signer.address), msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => addSignersToTransactionMessage([signer], msg),
    (msg) => appendTransactionMessageInstruction(deactivateIx, msg),
  );
  onStatus?.("Signing transaction...");
  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const encoded = getBase64EncodedWireTransaction(signedTx);
  onStatus?.("Broadcasting transaction...");
  return sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);
}

export async function withdrawStake(
  rpc: Rpc<SolanaRpcApi>,
  signer: WalletSigner,
  stakeAccountAddress: string,
  lamports: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Building transaction...");
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const withdrawIx = getWithdrawInstruction({
    stake: address(stakeAccountAddress),
    recipient: address(signer.address),
    withdrawAuthority: signer,
    args: lamports,
  });
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(address(signer.address), msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => addSignersToTransactionMessage([signer], msg),
    (msg) => appendTransactionMessageInstruction(withdrawIx, msg),
  );
  onStatus?.("Signing transaction...");
  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const encoded = getBase64EncodedWireTransaction(signedTx);
  onStatus?.("Broadcasting transaction...");
  return sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);
}
