import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
} from "@solana/kit";
import type { WalletEntry, WalletStore } from "../types/wallet.js";

const DATA_DIR = join(homedir(), ".wui");
const STORE_PATH = join(DATA_DIR, "wallets.json");
const KEYS_DIR = join(DATA_DIR, "keys");

// --- Storage helpers ---

function ensureKeysDir(): void {
  mkdirSync(KEYS_DIR, { recursive: true });
}

function readStore(): WalletStore {
  ensureKeysDir();
  if (!existsSync(STORE_PATH)) {
    return { wallets: [] };
  }
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf-8")) as WalletStore;
  } catch {
    throw new Error(
      `Wallet data file is corrupted: ${STORE_PATH}\n` +
      `Delete or fix the file to continue.`,
    );
  }
}

function writeStore(store: WalletStore): void {
  ensureKeysDir();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// --- Keypair helpers ---

/** Read a Solana CLI keypair file (JSON array of 64 bytes). */
function readKeypairBytes(path: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    throw new Error(`Keypair file is not valid JSON: ${path}`);
  }
  const bytes = new Uint8Array(parsed as number[]);
  if (bytes.length !== 64) {
    throw new Error(
      `Invalid keypair file: expected 64 bytes, got ${bytes.length}`,
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
 * Validate a user-facing wallet label.
 * Allows spaces, but rejects empty labels and path-like characters.
 */
function validateLabel(label: string): void {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("Label cannot be empty.");
  }
  if (trimmed.length > 40) {
    throw new Error("Label must be 40 characters or fewer.");
  }
  if (/[\\/]/.test(trimmed)) {
    throw new Error(
      "Label cannot contain slashes."
    );
  }
}

/** Convert a wallet label into a filesystem-safe filename. */
function labelToFilename(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "wallet";
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
  const normalizedLabel = label.trim();

  // Expand ~ to home directory.
  const expandedPath = keypairPath.startsWith("~/")
    ? join(homedir(), keypairPath.slice(2))
    : keypairPath;
  const absolutePath = resolve(expandedPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Keypair file not found: ${absolutePath}`);
  }

  validateLabel(normalizedLabel);
  const signer = await signerFromKeypairFile(absolutePath);
  const store = readStore();

  if (store.wallets.some((w) => w.publicKey === signer.address)) {
    throw new Error(`Wallet already imported: ${signer.address}`);
  }

  if (store.wallets.some((w) => w.label === normalizedLabel)) {
    throw new Error(`Label already in use: ${normalizedLabel}`);
  }

  const entry: WalletEntry = {
    label: normalizedLabel,
    publicKey: signer.address,
    keypairPath: absolutePath,
    isActive: store.wallets.length === 0,
  };

  store.wallets.push(entry);
  writeStore(store);
  return entry;
}

export async function createWallet(label: string): Promise<WalletEntry> {
  const normalizedLabel = label.trim();
  validateLabel(normalizedLabel);
  const store = readStore();

  if (store.wallets.some((w) => w.label === normalizedLabel)) {
    throw new Error(`Label already in use: ${normalizedLabel}`);
  }

  const keypairPath = join(KEYS_DIR, `${labelToFilename(normalizedLabel)}.json`);

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
    writeFileSync(keypairPath, JSON.stringify(Array.from(fullKeypair)), { encoding: "utf-8", mode: 0o600 });
  }

  const entry: WalletEntry = {
    label: normalizedLabel,
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
  const normalizedLabel = newLabel.trim();
  validateLabel(normalizedLabel);
  const store = readStore();
  const wallet = store.wallets.find((w) => w.label === currentLabel);

  if (!wallet) {
    throw new Error(`Wallet not found: ${currentLabel}`);
  }

  if (store.wallets.some((w) => w.label === normalizedLabel)) {
    throw new Error(`Label already in use: ${normalizedLabel}`);
  }

  wallet.label = normalizedLabel;
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
