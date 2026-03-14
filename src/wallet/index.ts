import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
} from "@solana/kit";
import type { WalletEntry, WalletStore } from "../types/wallet.js";

const DATA_DIR = join(homedir(), ".walletui");
const STORE_PATH = join(DATA_DIR, "wallets.json");
const KEYS_DIR = join(DATA_DIR, "keys");

// --- Storage helpers ---

function ensureDataDir(): void {
  mkdirSync(KEYS_DIR, { recursive: true });
}

function readStore(): WalletStore {
  ensureDataDir();
  if (!existsSync(STORE_PATH)) {
    return { wallets: [] };
  }
  return JSON.parse(readFileSync(STORE_PATH, "utf-8")) as WalletStore;
}

function writeStore(store: WalletStore): void {
  ensureDataDir();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// --- Keypair helpers ---

/** Read a Solana CLI keypair file (JSON array of 64 bytes). */
function readKeypairBytes(path: string): Uint8Array {
  const bytes = new Uint8Array(JSON.parse(readFileSync(path, "utf-8")));
  if (bytes.length !== 64) {
    throw new Error(
      `Invalid keypair file: expected 64 bytes, got ${bytes.length}`
    );
  }
  return bytes;
}

/** Extract the 32-byte private key seed from a 64-byte keypair. */
function privateKeyFromKeypair(keypairBytes: Uint8Array): Uint8Array {
  return keypairBytes.slice(0, 32);
}

/** Create a signer from a keypair file path. */
async function signerFromKeypairFile(path: string): Promise<KeyPairSigner> {
  const bytes = readKeypairBytes(path);
  return createKeyPairSignerFromPrivateKeyBytes(privateKeyFromKeypair(bytes));
}

/**
 * Validate a label for use as a wallet name and filename.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
function validateLabel(label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(label)) {
    throw new Error(
      "Label must start with a letter or number and contain only letters, numbers, hyphens, and underscores."
    );
  }
}

// --- Public API ---

export function listWallets(): WalletEntry[] {
  return readStore().wallets;
}

export function getActiveWalletEntry(): WalletEntry | null {
  return readStore().wallets.find((w) => w.isActive) ?? null;
}

export async function getActiveWalletSigner(): Promise<KeyPairSigner | null> {
  const entry = getActiveWalletEntry();
  if (!entry) return null;
  return signerFromKeypairFile(entry.keypairPath);
}

export async function importWallet(
  keypairPath: string,
  label: string
): Promise<WalletEntry> {
  // Expand ~ to home directory.
  const expandedPath = keypairPath.startsWith("~/")
    ? join(homedir(), keypairPath.slice(2))
    : keypairPath;
  const absolutePath = resolve(expandedPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Keypair file not found: ${absolutePath}`);
  }

  validateLabel(label);
  const signer = await signerFromKeypairFile(absolutePath);
  const store = readStore();

  if (store.wallets.some((w) => w.publicKey === signer.address)) {
    throw new Error(`Wallet already imported: ${signer.address}`);
  }

  if (store.wallets.some((w) => w.label === label)) {
    throw new Error(`Label already in use: ${label}`);
  }

  const entry: WalletEntry = {
    label,
    publicKey: signer.address,
    keypairPath: absolutePath,
    isActive: store.wallets.length === 0,
  };

  store.wallets.push(entry);
  writeStore(store);
  return entry;
}

export async function createWallet(label: string): Promise<WalletEntry> {
  validateLabel(label);
  const store = readStore();

  if (store.wallets.some((w) => w.label === label)) {
    throw new Error(`Label already in use: ${label}`);
  }

  const keypairPath = join(KEYS_DIR, `${label}.json`);

  let signer: KeyPairSigner;

  if (existsSync(keypairPath)) {
    // Reuse existing keypair file (e.g. from a previously deleted wallet with the same label).
    signer = await signerFromKeypairFile(keypairPath);
    if (store.wallets.some((w) => w.publicKey === signer.address)) {
      throw new Error(`Wallet with this keypair already exists under a different label.`);
    }
  } else {
    // Generate new keypair.
    const seed = new Uint8Array(32);
    crypto.getRandomValues(seed);
    signer = await createKeyPairSignerFromPrivateKeyBytes(seed);

    // Save in Solana CLI format: [seed(32) + pubkey(32)]
    const pubBytes = new Uint8Array(
      await crypto.subtle.exportKey("raw", signer.keyPair.publicKey)
    );
    const fullKeypair = new Uint8Array(64);
    fullKeypair.set(seed, 0);
    fullKeypair.set(pubBytes, 32);
    writeFileSync(keypairPath, JSON.stringify(Array.from(fullKeypair)), "utf-8");
  }

  const entry: WalletEntry = {
    label,
    publicKey: signer.address,
    keypairPath,
    isActive: store.wallets.length === 0,
  };

  store.wallets.push(entry);
  writeStore(store);
  return entry;
}

export function switchWallet(labelOrIndex: string | number): WalletEntry {
  const store = readStore();

  const target =
    typeof labelOrIndex === "number"
      ? store.wallets[labelOrIndex]
      : store.wallets.find((w) => w.label === labelOrIndex);

  if (!target) {
    throw new Error(`Wallet not found: ${labelOrIndex}`);
  }

  for (const w of store.wallets) {
    w.isActive = w.publicKey === target.publicKey;
  }

  writeStore(store);
  return target;
}

export function labelWallet(
  currentLabel: string,
  newLabel: string
): WalletEntry {
  validateLabel(newLabel);
  const store = readStore();
  const wallet = store.wallets.find((w) => w.label === currentLabel);

  if (!wallet) {
    throw new Error(`Wallet not found: ${currentLabel}`);
  }

  if (store.wallets.some((w) => w.label === newLabel)) {
    throw new Error(`Label already in use: ${newLabel}`);
  }

  wallet.label = newLabel;
  writeStore(store);
  return wallet;
}

export function deleteWallet(label: string): void {
  const store = readStore();
  const index = store.wallets.findIndex((w) => w.label === label);

  if (index === -1) {
    throw new Error(`Wallet not found: ${label}`);
  }

  const wasActive = store.wallets[index].isActive;
  store.wallets.splice(index, 1);

  if (wasActive && store.wallets.length > 0) {
    store.wallets[0].isActive = true;
  }

  writeStore(store);
}
