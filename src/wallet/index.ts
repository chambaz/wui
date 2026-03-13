import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
} from "@solana/kit";
import type { WalletEntry, WalletStore } from "../types/wallet.js";

const DATA_DIR = join(homedir(), ".walletui");
const STORE_PATH = join(DATA_DIR, "wallets.json");
const KEYS_DIR = join(DATA_DIR, "keys");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
}

function readStore(): WalletStore {
  ensureDataDir();
  if (!existsSync(STORE_PATH)) {
    return { wallets: [] };
  }
  const raw = readFileSync(STORE_PATH, "utf-8");
  return JSON.parse(raw) as WalletStore;
}

function writeStore(store: WalletStore): void {
  ensureDataDir();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Read a Solana CLI keypair file (JSON array of 64 bytes)
 * and return the 32-byte private key seed.
 */
function readKeypairBytes(path: string): Uint8Array {
  const raw = readFileSync(path, "utf-8");
  const bytes = new Uint8Array(JSON.parse(raw));
  if (bytes.length !== 64) {
    throw new Error(
      `Invalid keypair file: expected 64 bytes, got ${bytes.length}`
    );
  }
  return bytes;
}

/**
 * Get the public key (address) from a keypair file without creating a full signer.
 */
async function addressFromKeypairFile(path: string): Promise<string> {
  const bytes = readKeypairBytes(path);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(
    bytes.slice(0, 32)
  );
  return signer.address;
}

// --- Public API ---

export function listWallets(): WalletEntry[] {
  return readStore().wallets;
}

export function getActiveWalletEntry(): WalletEntry | null {
  const store = readStore();
  return store.wallets.find((w) => w.isActive) ?? null;
}

export async function getActiveWalletSigner(): Promise<KeyPairSigner | null> {
  const entry = getActiveWalletEntry();
  if (!entry) return null;
  const bytes = readKeypairBytes(entry.keypairPath);
  return createKeyPairSignerFromPrivateKeyBytes(bytes.slice(0, 32));
}

export async function importWallet(
  keypairPath: string,
  label: string
): Promise<WalletEntry> {
  const absolutePath = keypairPath.startsWith("/")
    ? keypairPath
    : join(process.cwd(), keypairPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Keypair file not found: ${absolutePath}`);
  }

  const publicKey = await addressFromKeypairFile(absolutePath);
  const store = readStore();

  // Check for duplicate
  if (store.wallets.some((w) => w.publicKey === publicKey)) {
    throw new Error(`Wallet already imported: ${publicKey}`);
  }

  const isFirst = store.wallets.length === 0;
  const entry: WalletEntry = {
    label,
    publicKey,
    keypairPath: absolutePath,
    isActive: isFirst,
  };

  store.wallets.push(entry);
  writeStore(store);
  return entry;
}

export async function createWallet(label: string): Promise<WalletEntry> {
  ensureDataDir();

  // Generate 32 random bytes as seed
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);

  // Derive signer to get public key bytes
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const pubBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", signer.keyPair.publicKey)
  );

  // Save in Solana CLI format: [seed(32) + pubkey(32)]
  const fullKeypair = new Uint8Array(64);
  fullKeypair.set(seed, 0);
  fullKeypair.set(pubBytes, 32);

  const filename = `${label}.json`;
  const keypairPath = join(KEYS_DIR, filename);

  if (existsSync(keypairPath)) {
    throw new Error(`Key file already exists: ${keypairPath}`);
  }

  writeFileSync(keypairPath, JSON.stringify(Array.from(fullKeypair)), "utf-8");

  const store = readStore();
  const isFirst = store.wallets.length === 0;
  const entry: WalletEntry = {
    label,
    publicKey: signer.address,
    keypairPath,
    isActive: isFirst,
  };

  store.wallets.push(entry);
  writeStore(store);
  return entry;
}

export function switchWallet(labelOrIndex: string | number): WalletEntry {
  const store = readStore();

  let target: WalletEntry | undefined;
  if (typeof labelOrIndex === "number") {
    target = store.wallets[labelOrIndex];
  } else {
    target = store.wallets.find((w) => w.label === labelOrIndex);
  }

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

  // If deleted wallet was active, activate the first remaining wallet
  if (wasActive && store.wallets.length > 0) {
    store.wallets[0].isActive = true;
  }

  writeStore(store);
}
