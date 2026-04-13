import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import net from "net";
import { getTransactionDecoder, getTransactionEncoder, type KeyPairSigner } from "@solana/kit";
import type { WalletSigner } from "../types/wallet-signer.js";

type SignTransactionInput = Parameters<KeyPairSigner["signTransactions"]>[0];
type SignTransactionOutput = Awaited<ReturnType<KeyPairSigner["signTransactions"]>>;
type SignTransactionItem = SignTransactionInput[number];

const RUN_DIR = join(homedir(), ".wui", "run");
const SESSION_SOCKET_PATH = join(RUN_DIR, "auth.sock");
const SESSION_METADATA_PATH = join(RUN_DIR, "auth.json");

const RUN_DIR_MODE = 0o700;
const RUN_FILE_MODE = 0o600;
const SESSION_PROTOCOL_VERSION = 1;

export interface WalletSessionMetadata {
  version: 1;
  walletId: string;
  walletLabel: string;
  publicKey: string;
  socketPath: string;
  startedAt: string;
  lastActivityAt: string;
  maxExpiresAt: string;
  idleExpiresAt: string;
}

interface WalletSessionState {
  walletId: string;
  walletLabel: string;
  publicKey: string;
  signer: KeyPairSigner;
  startedAtMs: number;
  maxExpiresAtMs: number;
  idleExpiresAtMs: number;
  inactivityTimeoutMs: number;
}

interface SessionEnvelope<TType extends string, TPayload> {
  version: 1;
  type: TType;
  payload: TPayload;
}

interface SessionStatusRequest {
  walletId?: string;
}

interface SessionLockRequest {
  walletId?: string;
}

interface SessionStatusResponse {
  active: boolean;
  metadata: WalletSessionMetadata | null;
}

interface SessionLockResponse {
  locked: boolean;
}

interface SessionSignTransactionsRequest {
  walletId: string;
  transactionsBase64: string[];
}

interface SessionSignTransactionsResponse {
  walletId: string;
  signatures: Record<string, string>[];
}

type SessionRequest =
  | SessionEnvelope<"status", SessionStatusRequest>
  | SessionEnvelope<"lock", SessionLockRequest>
  | SessionEnvelope<"sign-transactions", SessionSignTransactionsRequest>;

type SessionResponse =
  | SessionEnvelope<"status", SessionStatusResponse>
  | SessionEnvelope<"lock", SessionLockResponse>
  | SessionEnvelope<"sign-transactions", SessionSignTransactionsResponse>
  | SessionEnvelope<"error", { message: string }>;

export interface WalletSessionOptions {
  walletId: string;
  walletLabel: string;
  publicKey: string;
  signer: KeyPairSigner;
  inactivityTimeoutMs: number;
  maxLifetimeMs: number;
  keepProcessAlive?: boolean;
}

export interface WalletSessionHandle {
  metadata: WalletSessionMetadata;
  getSigner(): KeyPairSigner;
  close(): Promise<void>;
}

export class WalletSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletSessionError";
  }
}

export class WalletSessionNotActiveError extends WalletSessionError {
  constructor() {
    super("CLI auth session is not active.");
    this.name = "WalletSessionNotActiveError";
  }
}

export class WalletSessionExpiredError extends WalletSessionError {
  constructor() {
    super("CLI auth session expired.");
    this.name = "WalletSessionExpiredError";
  }
}

function ensureRunDir(): void {
  mkdirSync(RUN_DIR, { recursive: true, mode: RUN_DIR_MODE });
  chmodSync(RUN_DIR, RUN_DIR_MODE);
}

function readMetadataFile(): WalletSessionMetadata | null {
  if (!existsSync(SESSION_METADATA_PATH)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(SESSION_METADATA_PATH, "utf-8"));
  } catch {
    throw new WalletSessionError(`Auth session metadata is corrupted: ${SESSION_METADATA_PATH}`);
  }

  if (
    !parsed
    || typeof parsed !== "object"
    || (parsed as WalletSessionMetadata).version !== SESSION_PROTOCOL_VERSION
    || typeof (parsed as WalletSessionMetadata).walletId !== "string"
    || typeof (parsed as WalletSessionMetadata).walletLabel !== "string"
    || typeof (parsed as WalletSessionMetadata).publicKey !== "string"
    || typeof (parsed as WalletSessionMetadata).socketPath !== "string"
    || typeof (parsed as WalletSessionMetadata).startedAt !== "string"
    || typeof (parsed as WalletSessionMetadata).lastActivityAt !== "string"
    || typeof (parsed as WalletSessionMetadata).maxExpiresAt !== "string"
    || typeof (parsed as WalletSessionMetadata).idleExpiresAt !== "string"
  ) {
    throw new WalletSessionError(`Auth session metadata is corrupted: ${SESSION_METADATA_PATH}`);
  }

  return parsed as WalletSessionMetadata;
}

function writeMetadataFile(metadata: WalletSessionMetadata): void {
  ensureRunDir();
  writeFileSync(SESSION_METADATA_PATH, JSON.stringify(metadata, null, 2), {
    encoding: "utf-8",
    mode: RUN_FILE_MODE,
  });
  chmodSync(SESSION_METADATA_PATH, RUN_FILE_MODE);
}

function removeRuntimeArtifacts(): void {
  rmSync(SESSION_METADATA_PATH, { force: true });
  rmSync(SESSION_SOCKET_PATH, { force: true });
}

function toMetadata(state: WalletSessionState): WalletSessionMetadata {
  return {
    version: SESSION_PROTOCOL_VERSION,
    walletId: state.walletId,
    walletLabel: state.walletLabel,
    publicKey: state.publicKey,
    socketPath: SESSION_SOCKET_PATH,
    startedAt: new Date(state.startedAtMs).toISOString(),
    lastActivityAt: new Date().toISOString(),
    maxExpiresAt: new Date(state.maxExpiresAtMs).toISOString(),
    idleExpiresAt: new Date(state.idleExpiresAtMs).toISOString(),
  };
}

function encodeResponse(response: SessionResponse): string {
  return `${JSON.stringify(response)}\n`;
}

function parseSessionError(message: string): WalletSessionError {
  if (message === "CLI auth session expired.") {
    return new WalletSessionExpiredError();
  }

  if (message === "CLI auth session is not active.") {
    return new WalletSessionNotActiveError();
  }

  return new WalletSessionError(message);
}

function parseRequest(raw: string): SessionRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WalletSessionError("Invalid auth session request.");
  }

  if (
    !parsed
    || typeof parsed !== "object"
    || (parsed as SessionRequest).version !== SESSION_PROTOCOL_VERSION
    || typeof (parsed as SessionRequest).type !== "string"
    || typeof (parsed as SessionRequest).payload !== "object"
    || (parsed as SessionRequest).payload === null
  ) {
    throw new WalletSessionError("Invalid auth session request.");
  }

  return parsed as SessionRequest;
}

function touchSession(state: WalletSessionState): WalletSessionMetadata {
  state.idleExpiresAtMs = Date.now() + state.inactivityTimeoutMs;
  const metadata = toMetadata(state);
  writeMetadataFile(metadata);
  return metadata;
}

function currentMetadata(state: WalletSessionState): WalletSessionMetadata {
  return toMetadata(state);
}

function sessionExpired(state: WalletSessionState): WalletSessionExpiredError | null {
  const now = Date.now();
  if (now >= state.maxExpiresAtMs || now >= state.idleExpiresAtMs) {
    return new WalletSessionExpiredError();
  }

  return null;
}

async function sendSessionRequest(request: SessionRequest): Promise<SessionResponse> {
  const metadata = readMetadataFile();
  if (!metadata || !existsSync(metadata.socketPath)) {
    removeRuntimeArtifacts();
    throw new WalletSessionNotActiveError();
  }

  return await new Promise<SessionResponse>((resolve, reject) => {
    const socket = net.createConnection(metadata.socketPath);
    let buffer = "";

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const message = buffer.slice(0, newlineIndex);
      socket.end();

      try {
        const response = JSON.parse(message) as SessionResponse;
        if (response.type === "error") {
          reject(parseSessionError(response.payload.message));
          return;
        }

        resolve(response);
      } catch {
        reject(new WalletSessionError("Invalid auth session response."));
      }
    });

    socket.on("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
        removeRuntimeArtifacts();
        reject(new WalletSessionNotActiveError());
        return;
      }

      reject(error);
    });
  });
}

export function getWalletSessionSocketPath(): string {
  ensureRunDir();
  return SESSION_SOCKET_PATH;
}

export function getWalletSessionMetadataPath(): string {
  ensureRunDir();
  return SESSION_METADATA_PATH;
}

export function readWalletSessionMetadata(): WalletSessionMetadata | null {
  return readMetadataFile();
}

export function clearWalletSessionRuntimeArtifacts(): void {
  ensureRunDir();
  removeRuntimeArtifacts();
}

export async function getWalletSessionStatus(): Promise<WalletSessionMetadata | null> {
  try {
    const response = await sendSessionRequest({
      version: SESSION_PROTOCOL_VERSION,
      type: "status",
      payload: {},
    });

    return response.type === "status" ? response.payload.metadata : null;
  } catch (error: unknown) {
    if (error instanceof WalletSessionNotActiveError || error instanceof WalletSessionExpiredError) {
      return null;
    }

    throw error;
  }
}

export async function lockWalletSession(): Promise<void> {
  try {
    await sendSessionRequest({
      version: SESSION_PROTOCOL_VERSION,
      type: "lock",
      payload: {},
    });
  } catch (error: unknown) {
    if (error instanceof WalletSessionNotActiveError || error instanceof WalletSessionExpiredError) {
      removeRuntimeArtifacts();
      return;
    }

    throw error;
  }
}

function encodeSignatureDictionary(dictionary: Record<string, Uint8Array>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dictionary).map(([address, signature]) => [address, Buffer.from(signature).toString("base64")]),
  );
}

function decodeSignatureDictionary(dictionary: Record<string, string>): Record<string, Uint8Array> {
  return Object.fromEntries(
    Object.entries(dictionary).map(([address, signature]) => [address, new Uint8Array(Buffer.from(signature, "base64"))]),
  );
}

function decodeTransactionsForSigning(transactionsBase64: string[]): SignTransactionInput {
  const decoder = getTransactionDecoder();
  const decodedTransactions: SignTransactionItem[] = transactionsBase64.map((transactionBase64) => {
    const bytes = new Uint8Array(Buffer.from(transactionBase64, "base64"));
    return decoder.decode(bytes) as SignTransactionItem;
  });

  return decodedTransactions;
}

async function signTransactionsWithSessionSigner(
  signer: KeyPairSigner,
  transactions: SignTransactionInput,
): Promise<SignTransactionOutput> {
  return await signer.signTransactions(transactions);
}

export async function getWalletSessionSigner(walletId: string): Promise<WalletSigner | null> {
  try {
    const metadata = await getWalletSessionStatus();
    if (!metadata || metadata.walletId !== walletId) {
      return null;
    }

    return {
      address: metadata.publicKey,
      async signTransactions(transactions: readonly unknown[]): Promise<readonly Record<string, Uint8Array>[]> {
        const encoder = getTransactionEncoder();
        const response = await sendSessionRequest({
          version: SESSION_PROTOCOL_VERSION,
          type: "sign-transactions",
          payload: {
            walletId,
            transactionsBase64: transactions.map((transaction) => Buffer.from(encoder.encode(transaction as never)).toString("base64")),
          },
        });

        if (response.type !== "sign-transactions") {
          throw new WalletSessionError("Invalid auth session signing response.");
        }

        return response.payload.signatures.map((dictionary) => decodeSignatureDictionary(dictionary));
      },
    };
  } catch (error: unknown) {
    if (error instanceof WalletSessionNotActiveError || error instanceof WalletSessionExpiredError) {
      return null;
    }

    throw error;
  }
}

export async function startWalletSession(options: WalletSessionOptions): Promise<WalletSessionHandle> {
  ensureRunDir();

  const startedAtMs = Date.now();
  const state: WalletSessionState = {
    walletId: options.walletId,
    walletLabel: options.walletLabel,
    publicKey: options.publicKey,
    signer: options.signer,
    startedAtMs,
    maxExpiresAtMs: startedAtMs + options.maxLifetimeMs,
    idleExpiresAtMs: startedAtMs + options.inactivityTimeoutMs,
    inactivityTimeoutMs: options.inactivityTimeoutMs,
  };

  const existing = await getWalletSessionStatus();
  if (existing) {
    throw new WalletSessionError("CLI auth session is already active. Lock it before starting a new one.");
  }

  removeRuntimeArtifacts();

  let closed = false;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let server: net.Server | null = null;

  async function closeServer(): Promise<void> {
    if (closed) {
      return;
    }

    closed = true;
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    removeRuntimeArtifacts();

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  }

  function scheduleExpiry(): void {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
    }

    const now = Date.now();
    const msUntilExpiry = Math.max(0, Math.min(state.maxExpiresAtMs - now, state.idleExpiresAtMs - now));
    expiryTimer = setTimeout(() => {
      void closeServer();
    }, msUntilExpiry);
    expiryTimer.unref();
  }

  function writeResponse(socket: net.Socket, response: SessionResponse): void {
    socket.end(encodeResponse(response));
  }

  function writeError(socket: net.Socket, message: string): void {
    writeResponse(socket, {
      version: SESSION_PROTOCOL_VERSION,
      type: "error",
      payload: { message },
    });
  }

  server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", async (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const raw = buffer.slice(0, newlineIndex);

      try {
        const request = parseRequest(raw);
        const expired = sessionExpired(state);
        if (expired) {
          void closeServer();
          writeError(socket, expired.message);
          return;
        }

        if (
          "walletId" in request.payload
          && typeof request.payload.walletId === "string"
          && request.payload.walletId !== state.walletId
        ) {
          writeError(socket, "CLI auth session belongs to a different wallet.");
          return;
        }

        switch (request.type) {
          case "status": {
            const metadata = currentMetadata(state);
            writeResponse(socket, {
              version: SESSION_PROTOCOL_VERSION,
              type: "status",
              payload: {
                active: true,
                metadata,
              },
            });
            return;
          }
          case "lock": {
            void closeServer();
            writeResponse(socket, {
              version: SESSION_PROTOCOL_VERSION,
              type: "lock",
              payload: { locked: true },
            });
            return;
          }
          case "sign-transactions": {
            touchSession(state);
            scheduleExpiry();
            const transactions = decodeTransactionsForSigning(request.payload.transactionsBase64);
            const signatures = await signTransactionsWithSessionSigner(state.signer, transactions);
            writeResponse(socket, {
              version: SESSION_PROTOCOL_VERSION,
              type: "sign-transactions",
              payload: {
                walletId: state.walletId,
                signatures: signatures.map((dictionary) => encodeSignatureDictionary(dictionary as Record<string, Uint8Array>)),
              },
            });
            return;
          }
        }
      } catch (error: unknown) {
        writeError(socket, error instanceof Error ? error.message : "Unknown auth session error.");
      }
    });
  });

  if (!options.keepProcessAlive) {
    server.unref();
  }

  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(SESSION_SOCKET_PATH, () => {
      server!.off("error", reject);
      resolve();
    });
  });

  const metadata = touchSession(state);
  scheduleExpiry();

  return {
    metadata,
    getSigner(): KeyPairSigner {
      const expired = sessionExpired(state);
      if (expired) {
        throw expired;
      }

      touchSession(state);
      scheduleExpiry();
      return state.signer;
    },
    async close(): Promise<void> {
      await closeServer();
    },
  };
}
