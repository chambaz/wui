import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
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
  generateKeyPairSigner,
} from "@solana/kit";
import {
  getInitializeInstruction,
  getDelegateStakeInstruction,
  getDeactivateInstruction,
  getWithdrawInstruction,
} from "@solana-program/stake";
import { getCreateAccountInstruction } from "@solana-program/system";
import { formatTransactionError } from "../errors/index.js";
import type {
  StakeAccountInfo,
  StakeStatus,
  StakeProvider,
  CustomValidator,
} from "../types/staking.js";

// --- Constants ---

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const STAKE_POOL_PROGRAM = "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy";

/** Stake account data size in bytes. */
const STAKE_ACCOUNT_SIZE = 200n;

/** Confirmation polling interval. */
const CONFIRMATION_POLL_INTERVAL_MS = 2_000;

/** Maximum confirmation wait time. */
const CONFIRMATION_TIMEOUT_MS = 60_000;

/** Max epoch value (u64 max) — indicates stake is not deactivated. */
const MAX_EPOCH = 18446744073709551615n;

// --- Providers ---

/** Built-in liquid staking providers (both use SPL Stake Pool). */
export const STAKE_PROVIDERS: StakeProvider[] = [
  {
    id: "jito",
    label: "Jito (JitoSOL)",
    stakePoolAddress: "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb",
    lstMint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  },
  {
    id: "p0",
    label: "Project 0 (LST)",
    stakePoolAddress: "DqhH94PjkZsjAqEze2BEkWhFQJ6EyU6MdtMphMgnXqeK",
    lstMint: "LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp",
  },
];

// --- Custom Validators ---

const DATA_DIR = join(homedir(), ".wui");
const VALIDATORS_PATH = join(DATA_DIR, "validators.json");

/** Load custom validators from disk. */
export function loadCustomValidators(): CustomValidator[] {
  if (!existsSync(VALIDATORS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(VALIDATORS_PATH, "utf-8")) as CustomValidator[];
  } catch {
    return [];
  }
}

/** Save a new custom validator. */
export function saveCustomValidator(label: string, voteAccount: string): void {
  const validators = loadCustomValidators();
  if (validators.some((v) => v.voteAccount === voteAccount)) {
    throw new Error("Validator already exists.");
  }
  validators.push({ label, voteAccount });
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(VALIDATORS_PATH, JSON.stringify(validators, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// --- Helpers ---

/** Resolve a validator vote account to a human label. */
function resolveValidatorLabel(voteAccount: string): string | null {
  const custom = loadCustomValidators().find((v) => v.voteAccount === voteAccount);
  if (custom) return custom.label;
  return null;
}

/** Derive the ATA address for an owner + mint. */
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

/** Check if an account exists on-chain. */
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

/** Build create ATA instruction. */
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

/** Decode a 32-byte public key from raw bytes to a base58 address string. */
function decodeAddressFromBytes(bytes: Uint8Array): string {
  const decoder = getAddressDecoder();
  return decoder.decode(bytes);
}

/** Send a signed transaction and poll for confirmation. */
async function sendAndConfirm(
  rpc: Rpc<SolanaRpcApi>,
  signedBase64: ReturnType<typeof getBase64EncodedWireTransaction>,
  lastValidBlockHeight: bigint,
): Promise<string> {
  const signature = await rpc
    .sendTransaction(signedBase64, { encoding: "base64", skipPreflight: true })
    .send();

  const startTime = Date.now();
  while (Date.now() - startTime < CONFIRMATION_TIMEOUT_MS) {
    const blockHeight = await rpc.getBlockHeight().send();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error("Transaction expired before confirmation. Try again.");
    }

    const { value: statuses } = await rpc.getSignatureStatuses([signature]).send();
    const status = statuses[0];
    if (status) {
      if (status.err) throw new Error(formatTransactionError(status.err));
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return signature;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS));
  }

  throw new Error(`Transaction confirmation timed out. Check status manually: ${signature}`);
}

// --- Fetch Stake Accounts ---

/** Determine the status of a stake account given epoch info. */
export function getStakeAccountStatus(
  activationEpoch: bigint,
  deactivationEpoch: bigint,
  currentEpoch: bigint,
): StakeStatus {
  if (deactivationEpoch !== MAX_EPOCH) {
    return currentEpoch > deactivationEpoch ? "deactivated" : "deactivating";
  }
  if (currentEpoch === activationEpoch) return "activating";
  return "active";
}

/**
 * Fetch all native stake accounts for a wallet.
 * Uses getProgramAccounts with memcmp filter on withdraw authority.
 */
export async function fetchStakeAccounts(
  rpc: Rpc<SolanaRpcApi>,
  walletAddress: string,
): Promise<StakeAccountInfo[]> {
  const epochInfo = await rpc.getEpochInfo().send();
  const currentEpoch = BigInt(epochInfo.epoch);

  const accounts = await rpc
    .getProgramAccounts(address("Stake11111111111111111111111111111111111111"), {
      encoding: "jsonParsed",
      filters: [
        { dataSize: STAKE_ACCOUNT_SIZE },
        {
          memcmp: {
            offset: 44n,
            bytes: walletAddress as never,
            encoding: "base58",
          },
        },
      ],
    })
    .send();

  const result: StakeAccountInfo[] = [];

  for (const account of accounts) {
    const lamports = account.account.lamports;
    const parsed = account.account.data as unknown as {
      parsed?: {
        info?: {
          stake?: {
            delegation?: {
              voter?: string;
              activationEpoch?: string;
              deactivationEpoch?: string;
            };
          };
        };
      };
    };

    const delegation = parsed?.parsed?.info?.stake?.delegation;
    const validator = delegation?.voter ?? null;

    let status: StakeStatus = "inactive";
    if (delegation?.activationEpoch !== undefined && delegation?.deactivationEpoch !== undefined) {
      status = getStakeAccountStatus(
        BigInt(delegation.activationEpoch),
        BigInt(delegation.deactivationEpoch),
        currentEpoch,
      );
    }

    result.push({
      address: account.pubkey,
      lamports,
      balance: Number(lamports) / 1e9,
      status,
      validator,
      validatorLabel: validator ? resolveValidatorLabel(validator) : null,
    });
  }

  const statusOrder: Record<StakeStatus, number> = {
    active: 0, activating: 1, deactivating: 2, deactivated: 3, inactive: 4,
  };
  result.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.balance - a.balance);

  return result;
}

// --- Liquid Staking (SPL Stake Pool depositSol) ---

/**
 * Deposit SOL into an SPL Stake Pool and receive LST tokens.
 * Works for any SPL Stake Pool provider (Jito, Project 0, etc.).
 */
export async function depositToStakePool(
  rpc: Rpc<SolanaRpcApi>,
  signer: KeyPairSigner,
  stakePoolAddress: string,
  lstMint: string,
  lamports: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Fetching pool data...");

  const poolInfo = await rpc
    .getAccountInfo(address(stakePoolAddress), { encoding: "base64" })
    .send();
  if (!poolInfo.value) throw new Error("Stake pool account not found.");

  const poolData = new Uint8Array(Buffer.from(poolInfo.value.data[0], "base64"));

  // SPL Stake Pool account layout offsets:
  //   130: reserveStake (32 bytes)
  //   162: poolMint (32 bytes)
  //   194: managerFeeAccount (32 bytes)
  const reserveStake = decodeAddressFromBytes(poolData.slice(130, 162));
  const poolMint = decodeAddressFromBytes(poolData.slice(162, 194));
  const managerFeeAccount = decodeAddressFromBytes(poolData.slice(194, 226));

  // Derive the withdraw authority PDA.
  const encoder = getAddressEncoder();
  const [withdrawAuthority] = await getProgramDerivedAddress({
    programAddress: address(STAKE_POOL_PROGRAM),
    seeds: [
      encoder.encode(address(stakePoolAddress)),
      new TextEncoder().encode("withdraw"),
    ],
  });

  // Ensure the user's LST ATA exists.
  const userLstAta = await getAssociatedTokenAddress(signer.address, lstMint);
  const lstAtaExists = await accountExists(rpc, userLstAta);

  onStatus?.("Building transaction...");

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // DepositSol instruction: [14u8, lamports: u64 LE] = 9 bytes.
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
      { address: address(managerFeeAccount), role: AccountRole.WRITABLE }, // referral = manager (no referral)
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
    const createAtaIx = buildCreateAtaInstruction(signer.address, userLstAta, signer.address, lstMint);
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

// --- Native Staking ---

/**
 * Create a new stake account and delegate to a validator.
 * Sends a single transaction with: CreateAccount + Initialize + DelegateStake.
 */
export async function createNativeStake(
  rpc: Rpc<SolanaRpcApi>,
  signer: KeyPairSigner,
  validatorVoteAccount: string,
  lamports: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Building transaction...");

  const stakeAccountSigner = await generateKeyPairSigner();

  const rentExempt = await rpc
    .getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE)
    .send();
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
    arg0: {
      staker: address(signer.address),
      withdrawer: address(signer.address),
    },
    arg1: {
      unixTimestamp: 0n as never,
      epoch: 0n as never,
      custodian: address(SYSTEM_PROGRAM),
    },
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

// --- Deactivate & Withdraw ---

/** Deactivate a native stake account. */
export async function deactivateStake(
  rpc: Rpc<SolanaRpcApi>,
  signer: KeyPairSigner,
  stakeAccountAddress: string,
  onStatus?: (status: string) => void,
): Promise<string> {
  onStatus?.("Building transaction...");

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const deactivateIx = getDeactivateInstruction({
    stake: address(stakeAccountAddress),
    stakeAuthority: signer,
  });

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

/** Withdraw SOL from a deactivated stake account. */
export async function withdrawStake(
  rpc: Rpc<SolanaRpcApi>,
  signer: KeyPairSigner,
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
