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
} from "@solana/kit";
import {
  getInitializeInstruction,
  getDelegateStakeInstruction,
  getDeactivateInstruction,
  getWithdrawInstruction,
} from "@solana-program/stake";
import { getCreateAccountInstruction } from "@solana-program/system";
import type { WalletProvider } from "../wallet/provider.js";
import { STAKE_ACCOUNT_SIZE, SYSTEM_PROGRAM } from "./constants.js";
import { sendAndConfirm } from "./confirm.js";

export async function createNativeStake(
  rpc: Rpc<SolanaRpcApi>,
  provider: WalletProvider,
  validatorVoteAccount: string,
  lamports: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Building transaction...");
  const signer = await provider.getTransactionSigner();
  if (!signer) {
    throw new Error("Wallet does not expose a transaction signer for native staking.");
  }
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
    arg0: { staker: address(provider.publicKey), withdrawer: address(provider.publicKey) },
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
    (msg) => setTransactionMessageFeePayer(address(provider.publicKey), msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstruction(createAccountIx, msg),
    (msg) => appendTransactionMessageInstruction(initializeIx, msg),
    (msg) => appendTransactionMessageInstruction(delegateIx, msg),
  );

  const encoded = await provider.signTransactionMessage(txMessage, [stakeAccountSigner]);
  onStatus?.("Broadcasting transaction...");
  return sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);
}

export async function deactivateStake(
  rpc: Rpc<SolanaRpcApi>,
  provider: WalletProvider,
  stakeAccountAddress: string,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Building transaction...");
  const signer = await provider.getTransactionSigner();
  if (!signer) {
    throw new Error("Wallet does not expose a transaction signer for stake deactivation.");
  }
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const deactivateIx = getDeactivateInstruction({
    stake: address(stakeAccountAddress),
    stakeAuthority: signer,
  });
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(address(provider.publicKey), msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstruction(deactivateIx, msg),
  );
  onStatus?.("Signing transaction...");
  const encoded = await provider.signTransactionMessage(txMessage);
  onStatus?.("Broadcasting transaction...");
  return sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);
}

export async function withdrawStake(
  rpc: Rpc<SolanaRpcApi>,
  provider: WalletProvider,
  stakeAccountAddress: string,
  lamports: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Building transaction...");
  const signer = await provider.getTransactionSigner();
  if (!signer) {
    throw new Error("Wallet does not expose a transaction signer for stake withdrawal.");
  }
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const withdrawIx = getWithdrawInstruction({
    stake: address(stakeAccountAddress),
    recipient: address(provider.publicKey),
    withdrawAuthority: signer,
    args: lamports,
  });
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(address(provider.publicKey), msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstruction(withdrawIx, msg),
  );
  onStatus?.("Signing transaction...");
  const encoded = await provider.signTransactionMessage(txMessage);
  onStatus?.("Broadcasting transaction...");
  return sendAndConfirm(rpc, encoded, latestBlockhash.lastValidBlockHeight);
}
