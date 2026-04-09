import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv, webcrypto } from "crypto";
import { homedir } from "os";
import { join, resolve } from "path";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
} from "@solana/kit";
import type { WalletEntry, WalletStore } from "../types/wallet.js";

const DATA_DIR = join(homedir(), ".wui");
const STORE_PATH = join(DATA_DIR, "wallets.json");
const KEYS_DIR = join(DATA_DIR, "keys");

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const AUTO_LOCK_MS = 10 * 60 * 1000;
const MIN_PASSPHRASE_LENGTH = 12;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DK_LEN = 32;

interface EncryptedWalletFile {
  version: 1;
  id: string;
  publicKey: string;
  label: string;
  createdAt: string;
  crypto: {
    kdf: "scrypt";
    kdfparams: {
      N: number;
      r: number;
      p: number;
      dkLen: number;
      salt: string;
    };
    cipher: "aes-256-gcm";
    cipherparams: {
      iv: string;
    };
    ciphertext: string;
    authTag: string;
  };
}

interface LegacyWalletEntry {
  label: string;
  publicKey: string;
  keypairPath: string;
  isActive: boolean;
}

interface RawWalletStore {
  wallets?: unknown[];
}

interface UnlockedWalletSession {
  signer: KeyPairSigner;
  timer: ReturnType<typeof setTimeout>;
}

export interface LegacyWalletMigrationInfo {
  count: number;
  labels: string[];
}

const unlockedWallets = new Map<string, UnlockedWalletSession>();

export class WalletLockedError extends Error {
  walletId: string;

  constructor(walletId: string, label: string) {
    super(`Wallet "${label}" is locked.`);
    this.name = "WalletLockedError";
    this.walletId = walletId;
  }
}

export class WalletPassphraseError extends Error {
  constructor() {
    super("Incorrect passphrase.");
    this.name = "WalletPassphraseError";
  }
}

export class WalletCorruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletCorruptedError";
  }
}

export class WalletMigrationRequiredError extends Error {
  constructor(count: number) {
    super(
      `Wallet storage upgrade required for ${count} wallet${count === 1 ? "" : "s"}. Run \`wui\` interactively to migrate them.`,
    );
    this.name = "WalletMigrationRequiredError";
  }
}

function ensureDataDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: DIR_MODE });
  mkdirSync(KEYS_DIR, { recursive: true, mode: DIR_MODE });
  chmodSync(DATA_DIR, DIR_MODE);
  chmodSync(KEYS_DIR, DIR_MODE);
}

function expandPath(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function normalizePath(path: string): string {
  return resolve(expandPath(path));
}

function isWalletEntry(entry: unknown): entry is WalletEntry {
  return Boolean(
    entry &&
    typeof entry === "object" &&
    typeof (entry as WalletEntry).id === "string" &&
    typeof (entry as WalletEntry).label === "string" &&
    typeof (entry as WalletEntry).publicKey === "string" &&
    typeof (entry as WalletEntry).keyfilePath === "string" &&
    typeof (entry as WalletEntry).isActive === "boolean" &&
    (entry as WalletEntry).storageType === "encrypted",
  );
}

function isLegacyWalletEntry(entry: unknown): entry is LegacyWalletEntry {
  return Boolean(
    entry &&
    typeof entry === "object" &&
    typeof (entry as LegacyWalletEntry).label === "string" &&
    typeof (entry as LegacyWalletEntry).publicKey === "string" &&
    typeof (entry as LegacyWalletEntry).keypairPath === "string" &&
    typeof (entry as LegacyWalletEntry).isActive === "boolean" &&
    typeof (entry as Record<string, unknown>).id === "undefined" &&
    typeof (entry as Record<string, unknown>).keyfilePath === "undefined"
  );
}

function validateWalletEntry(entry: unknown): WalletEntry {
  if (!isWalletEntry(entry)) {
    throw new Error(
      `Wallet data file uses an unsupported format: ${STORE_PATH}
Run \`wui\` interactively to migrate existing wallets.`,
    );
  }

  return {
    ...entry,
    keyfilePath: getKeyfilePath(entry.id),
  };
}

function readRawStore(): RawWalletStore {
  ensureDataDirs();

  if (!existsSync(STORE_PATH)) {
    return { wallets: [] };
  }

  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf-8")) as RawWalletStore;
  } catch {
    throw new Error(
      `Wallet data file is corrupted: ${STORE_PATH}
Delete or fix the file to continue.`,
    );
  }
}

function readEncryptedStore(): WalletStore {
  const rawStore = readRawStore();
  const wallets = Array.isArray(rawStore.wallets) ? rawStore.wallets : [];

  for (const entry of wallets) {
    if (!isWalletEntry(entry) && !isLegacyWalletEntry(entry)) {
      throw new Error(
        `Wallet data file is corrupted: ${STORE_PATH}
Delete or fix the file to continue.`,
      );
    }
  }

  return {
    wallets: wallets.filter(isWalletEntry).map(validateWalletEntry),
  };
}

function readLegacyEntries(): LegacyWalletEntry[] {
  const rawStore = readRawStore();
  if (!Array.isArray(rawStore.wallets)) {
    return [];
  }

  return rawStore.wallets.filter(isLegacyWalletEntry);
}

function readStore(): WalletStore {
  const legacyEntries = readLegacyEntries();
  if (legacyEntries.length > 0) {
    throw new WalletMigrationRequiredError(legacyEntries.length);
  }

  return readEncryptedStore();
}

function writeStore(store: WalletStore): void {
  ensureDataDirs();
  const normalizedStore: WalletStore = {
    wallets: store.wallets.map((wallet) => ({
      ...wallet,
      keyfilePath: getKeyfilePath(wallet.id),
    })),
  };

  writeFileSync(STORE_PATH, JSON.stringify(normalizedStore, null, 2), {
    encoding: "utf-8",
    mode: FILE_MODE,
  });
  chmodSync(STORE_PATH, FILE_MODE);
}

function validateLabel(label: string): void {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("Label cannot be empty.");
  }
  if (trimmed.length > 40) {
    throw new Error("Label must be 40 characters or fewer.");
  }
  if (/[\\/]/.test(trimmed)) {
    throw new Error("Label cannot contain slashes.");
  }
}

function validatePassphrase(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
}

function getWalletEntryById(walletId: string): WalletEntry {
  const wallet = readStore().wallets.find((entry) => entry.id === walletId);
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletId}`);
  }
  return wallet;
}

function getKeyfilePath(walletId: string): string {
  return join(KEYS_DIR, `${walletId}.json`);
}

function isManagedLegacyKeyfile(path: string): boolean {
  const absolutePath = normalizePath(path);
  return absolutePath.startsWith(`${KEYS_DIR}/`);
}

function readPlaintextKeypairBytes(path: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    throw new Error(`Keypair file is not valid JSON: ${path}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid keypair file: expected a 64-byte array in ${path}`);
  }

  const bytes = new Uint8Array(parsed as number[]);
  if (bytes.length !== 64) {
    throw new Error(`Invalid keypair file: expected 64 bytes, got ${bytes.length}`);
  }

  return bytes;
}

function privateKeyFromKeypair(keypairBytes: Uint8Array): Uint8Array {
  return keypairBytes.slice(0, 32);
}

async function signerFromKeypairBytes(keypairBytes: Uint8Array): Promise<KeyPairSigner> {
  return createKeyPairSignerFromPrivateKeyBytes(privateKeyFromKeypair(keypairBytes));
}

function deriveEncryptionKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, SCRYPT_DK_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

function createEncryptedWalletFile(
  keypairBytes: Uint8Array,
  walletId: string,
  label: string,
  publicKey: string,
  passphrase: string,
): EncryptedWalletFile {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = deriveEncryptionKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.from(JSON.stringify(Array.from(keypairBytes)), "utf-8");

  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();

  key.fill(0);
  payload.fill(0);

  return {
    version: 1,
    id: walletId,
    publicKey,
    label,
    createdAt: new Date().toISOString(),
    crypto: {
      kdf: "scrypt",
      kdfparams: {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        dkLen: SCRYPT_DK_LEN,
        salt: salt.toString("hex"),
      },
      cipher: "aes-256-gcm",
      cipherparams: {
        iv: iv.toString("hex"),
      },
      ciphertext: ciphertext.toString("hex"),
      authTag: authTag.toString("hex"),
    },
  };
}

function readEncryptedWalletFile(path: string): EncryptedWalletFile {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    throw new WalletCorruptedError(`Wallet file is corrupted: ${path}`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as EncryptedWalletFile).version !== 1 ||
    !(parsed as EncryptedWalletFile).crypto
  ) {
    throw new WalletCorruptedError(`Wallet file uses an unsupported format: ${path}`);
  }

  return parsed as EncryptedWalletFile;
}

function assertHexString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length % 2 !== 0 || /[^0-9a-f]/i.test(value)) {
    throw new WalletCorruptedError(`Wallet file is corrupted: invalid ${field}.`);
  }

  return value;
}

function assertObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new WalletCorruptedError(`Wallet file is corrupted: invalid ${field}.`);
  }

  return value as Record<string, unknown>;
}

function assertNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WalletCorruptedError(`Wallet file is corrupted: invalid ${field}.`);
  }

  return value;
}

function validateEncryptedWalletFile(file: EncryptedWalletFile): void {
  const crypto = assertObject(file.crypto, "crypto");
  const kdfparams = assertObject(crypto.kdfparams, "kdfparams");
  const cipherparams = assertObject(crypto.cipherparams, "cipherparams");

  if (crypto.kdf !== "scrypt") {
    throw new WalletCorruptedError("Wallet file is corrupted: unsupported key derivation function.");
  }

  if (crypto.cipher !== "aes-256-gcm") {
    throw new WalletCorruptedError("Wallet file is corrupted: unsupported cipher.");
  }

  if (
    assertNumber(kdfparams.N, "kdfparams.N") !== SCRYPT_N ||
    assertNumber(kdfparams.r, "kdfparams.r") !== SCRYPT_R ||
    assertNumber(kdfparams.p, "kdfparams.p") !== SCRYPT_P ||
    assertNumber(kdfparams.dkLen, "kdfparams.dkLen") !== SCRYPT_DK_LEN
  ) {
    throw new WalletCorruptedError("Wallet file is corrupted: unsupported key derivation parameters.");
  }

  assertHexString(kdfparams.salt, "salt");
  const iv = assertHexString(cipherparams.iv, "iv");
  const authTag = assertHexString(crypto.authTag, "auth tag");
  assertHexString(crypto.ciphertext, "ciphertext");

  if (Buffer.from(iv, "hex").length !== 12) {
    throw new WalletCorruptedError("Wallet file is corrupted: invalid IV length.");
  }

  if (Buffer.from(authTag, "hex").length !== 16) {
    throw new WalletCorruptedError("Wallet file is corrupted: invalid auth tag length.");
  }
}

function decryptWalletFile(file: EncryptedWalletFile, passphrase: string): Uint8Array {
  validateEncryptedWalletFile(file);

  let key: Buffer | null = null;
  let plaintext: Buffer | null = null;

  try {
    const salt = Buffer.from(file.crypto.kdfparams.salt, "hex");
    const iv = Buffer.from(file.crypto.cipherparams.iv, "hex");
    const ciphertext = Buffer.from(file.crypto.ciphertext, "hex");
    const authTag = Buffer.from(file.crypto.authTag, "hex");
    key = deriveEncryptionKey(passphrase, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    const parsed = JSON.parse(plaintext.toString("utf-8")) as number[];

    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new WalletCorruptedError(`Wallet file contains invalid key material: ${file.id}`);
    }

    return new Uint8Array(parsed);
  } catch (error: unknown) {
    if (error instanceof WalletCorruptedError) {
      throw error;
    }

    throw new WalletPassphraseError();
  } finally {
    key?.fill(0);
    plaintext?.fill(0);
  }
}

function writeEncryptedWalletFile(file: EncryptedWalletFile, path: string): void {
  ensureDataDirs();
  writeFileSync(path, JSON.stringify(file, null, 2), {
    encoding: "utf-8",
    mode: FILE_MODE,
  });
  chmodSync(path, FILE_MODE);
}

function clearUnlockedWallet(walletId: string): void {
  const session = unlockedWallets.get(walletId);
  if (!session) {
    return;
  }

  clearTimeout(session.timer);
  unlockedWallets.delete(walletId);
}

function createAutoLockTimer(walletId: string): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    unlockedWallets.delete(walletId);
  }, AUTO_LOCK_MS);
  timer.unref();
  return timer;
}

function scheduleAutoLock(walletId: string): void {
  const session = unlockedWallets.get(walletId);
  if (!session) {
    return;
  }

  clearTimeout(session.timer);
  session.timer = createAutoLockTimer(walletId);
}

async function createWalletEntry(
  keypairBytes: Uint8Array,
  label: string,
  passphrase: string,
): Promise<WalletEntry> {
  validateLabel(label);
  validatePassphrase(passphrase);

  const store = readStore();
  if (store.wallets.some((wallet) => wallet.label === label)) {
    throw new Error(`Label already in use: ${label}`);
  }

  const signer = await signerFromKeypairBytes(keypairBytes);
  if (store.wallets.some((wallet) => wallet.publicKey === signer.address)) {
    throw new Error(`Wallet already imported: ${signer.address}`);
  }

  const id = randomUUID();
  const keyfilePath = getKeyfilePath(id);
  const vaultFile = createEncryptedWalletFile(keypairBytes, id, label, signer.address, passphrase);
  writeEncryptedWalletFile(vaultFile, keyfilePath);

  const entry: WalletEntry = {
    id,
    label,
    publicKey: signer.address,
    keyfilePath,
    isActive: store.wallets.length === 0,
    storageType: "encrypted",
  };

  try {
    store.wallets.push(entry);
    writeStore(store);
  } catch (error: unknown) {
    if (existsSync(keyfilePath)) {
      unlinkSync(keyfilePath);
    }
    throw error;
  }

  return entry;
}

export function listWallets(): WalletEntry[] {
  return readStore().wallets;
}

export function getLegacyWalletMigrationInfo(): LegacyWalletMigrationInfo {
  const legacyEntries = readLegacyEntries();
  return {
    count: legacyEntries.length,
    labels: legacyEntries.map((entry) => entry.label),
  };
}

export function hasLegacyWallets(): boolean {
  return getLegacyWalletMigrationInfo().count > 0;
}

export function getActiveWalletEntry(): WalletEntry | null {
  return readStore().wallets.find((wallet) => wallet.isActive) ?? null;
}

export function isWalletUnlocked(walletId: string): boolean {
  return unlockedWallets.has(walletId);
}

export async function unlockWallet(walletId: string, passphrase: string): Promise<void> {
  validatePassphrase(passphrase);

  const entry = getWalletEntryById(walletId);
  const file = readEncryptedWalletFile(entry.keyfilePath);
  const keypairBytes = decryptWalletFile(file, passphrase);
  const signer = await signerFromKeypairBytes(keypairBytes);
  keypairBytes.fill(0);

  if (signer.address !== entry.publicKey || file.publicKey !== entry.publicKey) {
    throw new WalletCorruptedError(`Wallet file does not match wallet metadata: ${entry.label}`);
  }

  clearUnlockedWallet(walletId);
  unlockedWallets.set(walletId, {
    signer,
    timer: createAutoLockTimer(walletId),
  });
  scheduleAutoLock(walletId);
}

export function lockWallet(walletId: string): void {
  clearUnlockedWallet(walletId);
}

export function lockAllWallets(): void {
  for (const walletId of unlockedWallets.keys()) {
    clearUnlockedWallet(walletId);
  }
}

export async function getActiveWalletSigner(): Promise<KeyPairSigner | null> {
  const entry = getActiveWalletEntry();
  if (!entry) {
    return null;
  }

  const session = unlockedWallets.get(entry.id);
  if (!session) {
    throw new WalletLockedError(entry.id, entry.label);
  }

  scheduleAutoLock(entry.id);
  return session.signer;
}

export async function importWallet(keypairPath: string, label: string, passphrase: string): Promise<WalletEntry> {
  const absolutePath = normalizePath(keypairPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Keypair file not found: ${absolutePath}`);
  }

  const keypairBytes = readPlaintextKeypairBytes(absolutePath);
  try {
    return await createWalletEntry(keypairBytes, label.trim(), passphrase);
  } finally {
    keypairBytes.fill(0);
  }
}

export async function createWallet(label: string, passphrase: string): Promise<WalletEntry> {
  const normalizedLabel = label.trim();
  const seed = randomBytes(32);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const pubBytes = new Uint8Array(await webcrypto.subtle.exportKey("raw", signer.keyPair.publicKey));
  const fullKeypair = new Uint8Array(64);
  fullKeypair.set(seed, 0);
  fullKeypair.set(pubBytes, 32);
  seed.fill(0);

  try {
    return await createWalletEntry(fullKeypair, normalizedLabel, passphrase);
  } finally {
    fullKeypair.fill(0);
  }
}

export async function migrateLegacyWallets(passphrase: string): Promise<void> {
  validatePassphrase(passphrase);

  const legacyEntries = readLegacyEntries();
  if (legacyEntries.length === 0) {
    return;
  }

  const encryptedStore = readEncryptedStore();
  const nextWallets = [...encryptedStore.wallets];
  const createdFiles: string[] = [];
  const managedLegacyFilesToDelete: string[] = [];

  try {
    for (const legacyEntry of legacyEntries) {
      validateLabel(legacyEntry.label);

      if (nextWallets.some((wallet) => wallet.label === legacyEntry.label)) {
        throw new Error(`Cannot migrate duplicate wallet label: ${legacyEntry.label}`);
      }

      if (nextWallets.some((wallet) => wallet.publicKey === legacyEntry.publicKey)) {
        throw new Error(`Cannot migrate duplicate wallet public key: ${legacyEntry.publicKey}`);
      }

      const absolutePath = normalizePath(legacyEntry.keypairPath);
      if (!existsSync(absolutePath)) {
        throw new Error(`Legacy keypair file not found: ${absolutePath}`);
      }

      const keypairBytes = readPlaintextKeypairBytes(absolutePath);

      try {
        const signer = await signerFromKeypairBytes(keypairBytes);
        if (signer.address !== legacyEntry.publicKey) {
          throw new Error(`Legacy wallet public key mismatch for ${legacyEntry.label}`);
        }

        const id = randomUUID();
        const keyfilePath = getKeyfilePath(id);
        const vaultFile = createEncryptedWalletFile(
          keypairBytes,
          id,
          legacyEntry.label,
          legacyEntry.publicKey,
          passphrase,
        );

        writeEncryptedWalletFile(vaultFile, keyfilePath);
        createdFiles.push(keyfilePath);

        const verificationBytes = decryptWalletFile(vaultFile, passphrase);
        verificationBytes.fill(0);

        nextWallets.push({
          id,
          label: legacyEntry.label,
          publicKey: legacyEntry.publicKey,
          keyfilePath,
          isActive: legacyEntry.isActive,
          storageType: "encrypted",
        });

        if (isManagedLegacyKeyfile(absolutePath)) {
          managedLegacyFilesToDelete.push(absolutePath);
        }
      } finally {
        keypairBytes.fill(0);
      }
    }

    if (nextWallets.length > 0 && !nextWallets.some((wallet) => wallet.isActive)) {
      nextWallets[0].isActive = true;
    }

    writeStore({ wallets: nextWallets });
  } catch (error: unknown) {
    for (const path of createdFiles) {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
    throw error;
  }

  for (const path of managedLegacyFilesToDelete) {
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // Leave any remaining legacy file in place rather than failing after a successful migration.
      }
    }
  }
}

export function switchWallet(labelOrIndex: string | number): WalletEntry {
  const store = readStore();

  const target =
    typeof labelOrIndex === "number"
      ? store.wallets[labelOrIndex]
      : store.wallets.find((wallet) => wallet.label === labelOrIndex);

  if (!target) {
    throw new Error(`Wallet not found: ${labelOrIndex}`);
  }

  for (const wallet of store.wallets) {
    wallet.isActive = wallet.id === target.id;
  }

  lockAllWallets();
  writeStore(store);
  return target;
}

export function findWalletByLabelOrPublicKey(selector: string): WalletEntry | null {
  const store = readStore();

  return store.wallets.find((wallet) => wallet.publicKey === selector)
    ?? store.wallets.find((wallet) => wallet.label === selector)
    ?? null;
}

export function switchWalletByLabelOrPublicKey(selector: string): WalletEntry {
  const store = readStore();
  const target = store.wallets.find((wallet) => wallet.publicKey === selector)
    ?? store.wallets.find((wallet) => wallet.label === selector);

  if (!target) {
    throw new Error(`Wallet not found: ${selector}`);
  }

  for (const wallet of store.wallets) {
    wallet.isActive = wallet.id === target.id;
  }

  lockAllWallets();
  writeStore(store);
  return target;
}

export function labelWallet(currentLabel: string, newLabel: string): WalletEntry {
  const normalizedLabel = newLabel.trim();
  validateLabel(normalizedLabel);

  const store = readStore();
  const wallet = store.wallets.find((entry) => entry.label === currentLabel);

  if (!wallet) {
    throw new Error(`Wallet not found: ${currentLabel}`);
  }

  if (store.wallets.some((entry) => entry.label === normalizedLabel)) {
    throw new Error(`Label already in use: ${normalizedLabel}`);
  }

  wallet.label = normalizedLabel;
  writeStore(store);

  const file = readEncryptedWalletFile(wallet.keyfilePath);
  file.label = normalizedLabel;
  writeEncryptedWalletFile(file, wallet.keyfilePath);

  return wallet;
}

export function deleteWallet(label: string): void {
  const store = readStore();
  const index = store.wallets.findIndex((wallet) => wallet.label === label);

  if (index === -1) {
    throw new Error(`Wallet not found: ${label}`);
  }

  const [wallet] = store.wallets.splice(index, 1);
  lockWallet(wallet.id);
  const keyfileExisted = existsSync(wallet.keyfilePath);
  const keyfileContents = keyfileExisted ? readFileSync(wallet.keyfilePath, "utf-8") : null;

  if (wallet.isActive && store.wallets.length > 0) {
    store.wallets[0].isActive = true;
  }

  if (keyfileExisted) {
    unlinkSync(wallet.keyfilePath);
  }

  try {
    writeStore(store);
  } catch (error: unknown) {
    if (keyfileContents !== null) {
      writeFileSync(wallet.keyfilePath, keyfileContents, {
        encoding: "utf-8",
        mode: FILE_MODE,
      });
      chmodSync(wallet.keyfilePath, FILE_MODE);
    }
    throw error;
  }
}
