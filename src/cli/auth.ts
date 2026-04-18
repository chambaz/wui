import { fork } from "child_process";
import {
  bootstrapWalletStore,
  printJson,
} from "./index.js";
import { promptForPassphrase } from "./prompt.js";
import {
  getActiveWalletEntry,
  getActiveWalletSigner,
  getWalletSessionStatus,
  lockWalletSession,
  startWalletSession,
  unlockWallet,
} from "../wallet/index.js";

const DEFAULT_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_LIFETIME_MS = 15 * 60 * 1000;
const AUTH_SERVER_COMMAND = "__auth-session-server";

interface AuthServerStartMessage {
  type: "start";
  passphrase: string;
  inactivityTimeoutMs: number;
  maxLifetimeMs: number;
}

interface AuthServerReadyMessage {
  type: "ready";
  metadata: {
    walletLabel: string;
    publicKey: string;
    expiresInSeconds: number;
  };
}

interface AuthServerErrorMessage {
  type: "error";
  message: string;
}

interface AuthServerShutdownMessage {
  type: "shutdown-previous-session";
}

type AuthServerMessage =
  | AuthServerStartMessage
  | AuthServerReadyMessage
  | AuthServerErrorMessage
  | AuthServerShutdownMessage;

function parseAuthServerStartMessage(raw: unknown): AuthServerStartMessage {
  if (
    !raw
    || typeof raw !== "object"
    || (raw as AuthServerStartMessage).type !== "start"
    || typeof (raw as AuthServerStartMessage).passphrase !== "string"
    || typeof (raw as AuthServerStartMessage).inactivityTimeoutMs !== "number"
    || typeof (raw as AuthServerStartMessage).maxLifetimeMs !== "number"
  ) {
    throw new Error("Invalid auth session startup message.");
  }

  return raw as AuthServerStartMessage;
}

export const AUTH_USAGE = `Usage: wui auth <subcommand>

Subcommands:
  unlock                      Start a same-machine CLI auth session
  status                      Show current CLI auth session status
  lock                        End the current CLI auth session

Examples:
  wui auth unlock
  wui auth status
  wui auth lock`;

function expiresInSeconds(idleExpiresAt: string, maxExpiresAt: string): number {
  const now = Date.now();
  return Math.max(
    0,
    Math.floor((Math.min(Date.parse(idleExpiresAt), Date.parse(maxExpiresAt)) - now) / 1000),
  );
}

async function currentSessionSummary(activeWalletId: string) {
  const session = await getWalletSessionStatus();
  if (!session) {
    return null;
  }

  return {
    walletId: session.walletId,
    walletLabel: session.walletLabel,
    publicKey: session.publicKey,
    matchesActiveWallet: session.walletId === activeWalletId,
    expiresInSeconds: expiresInSeconds(session.idleExpiresAt, session.maxExpiresAt),
  };
}

async function spawnAuthSessionServer(walletId: string, passphrase: string): Promise<{ walletLabel: string; publicKey: string; expiresInSeconds: number; }> {
  return await new Promise((resolve, reject) => {
    const child = fork(process.argv[1]!, [AUTH_SERVER_COMMAND, walletId], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      execArgv: process.execArgv,
    });

    let settled = false;

    function cleanup(): void {
      child.removeAllListeners("message");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
    }

    child.once("message", (message: AuthServerMessage) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (message.type === "error") {
        reject(new Error(message.message));
        return;
      }

      if (message.type !== "ready") {
        reject(new Error("Invalid auth session server response."));
        return;
      }

      child.disconnect();
      child.unref();
      resolve(message.metadata);
    });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Auth session server exited before becoming ready${code === null ? "" : ` (code ${code})`}.`));
    });

    child.send({
      type: "start",
      passphrase,
      inactivityTimeoutMs: DEFAULT_INACTIVITY_TIMEOUT_MS,
      maxLifetimeMs: DEFAULT_MAX_LIFETIME_MS,
    } satisfies AuthServerStartMessage);
  });
}

export async function authCommand(args: string[], json: boolean): Promise<void> {
  const subcommand = args[0];
  const { wallet } = bootstrapWalletStore();

  switch (subcommand) {
    case "unlock": {
      if (!wallet) {
        throw new Error("No active wallet. Run `wui` and press [w] to create or import one.");
      }

      const passphrase = await promptForPassphrase(`Enter passphrase to unlock wallet "${wallet.label}": `);
      const session = await spawnAuthSessionServer(wallet.id, passphrase);

      if (json) {
        printJson({
          wallet: {
            label: session.walletLabel,
            publicKey: session.publicKey,
          },
          session: {
            active: true,
            expiresInSeconds: session.expiresInSeconds,
          },
        });
        return;
      }

      console.log(`Unlocked wallet "${session.walletLabel}" for CLI use.`);
      console.log(`Session expires in ${Math.ceil(session.expiresInSeconds / 60)} minutes of inactivity.`);
      return;
    }
    case "status": {
      if (!wallet) {
        throw new Error("No active wallet. Run `wui` and press [w] to create or import one.");
      }

      const session = await currentSessionSummary(wallet.id);
      if (json) {
        printJson({
          wallet: {
            label: wallet.label,
            publicKey: wallet.publicKey,
          },
          session: session
            ? {
                active: true,
                walletId: session.walletId,
                walletLabel: session.walletLabel,
                publicKey: session.publicKey,
                matchesActiveWallet: session.matchesActiveWallet,
                expiresInSeconds: session.expiresInSeconds,
              }
            : {
                active: false,
                expiresInSeconds: 0,
              },
        });
        return;
      }

      if (!session) {
        console.log("No active CLI auth session.");
        return;
      }

      if (!session.matchesActiveWallet) {
        console.log(
          `CLI auth session active for ${session.walletLabel} while the current active wallet is ${wallet.label} (expires in ${session.expiresInSeconds}s).`,
        );
        return;
      }

      console.log(`CLI auth session active for ${session.walletLabel} (expires in ${session.expiresInSeconds}s).`);
      return;
    }
    case "lock": {
      await lockWalletSession();

      if (json) {
        printJson({ locked: true });
        return;
      }

      console.log("CLI auth session locked.");
      return;
    }
    default:
      throw new Error(AUTH_USAGE);
  }
}

export async function runAuthSessionServer(walletId: string): Promise<void> {
  try {
    if (!walletId) {
      throw new Error("Wallet id is required for auth session startup.");
    }

    const message = await new Promise<AuthServerStartMessage>((resolve, reject) => {
      process.once("message", (raw: unknown) => {
        try {
          resolve(parseAuthServerStartMessage(raw));
        } catch (error: unknown) {
          reject(error);
        }
      });

      process.once("disconnect", () => {
        reject(new Error("Auth session startup was cancelled."));
      });
    });

    await unlockWallet(walletId, message.passphrase);
    const wallet = getActiveWalletEntry();
    if (!wallet || wallet.id !== walletId) {
      throw new Error("Active wallet changed before auth session startup completed.");
    }

    const signer = await getActiveWalletSigner();
    if (!signer) {
      throw new Error("Could not load wallet signer.");
    }

    await lockWalletSession();

    const handle = await startWalletSession({
      walletId: wallet.id,
      walletLabel: wallet.label,
      publicKey: wallet.publicKey,
      signer,
      inactivityTimeoutMs: message.inactivityTimeoutMs,
      maxLifetimeMs: message.maxLifetimeMs,
      keepProcessAlive: true,
      onClose: () => {
        process.exit(0);
      },
    });

    process.send?.({
      type: "ready",
      metadata: {
        walletLabel: wallet.label,
        publicKey: wallet.publicKey,
        expiresInSeconds: Math.max(0, Math.floor(message.inactivityTimeoutMs / 1000)),
      },
    } satisfies AuthServerReadyMessage);

    const close = async () => {
      await handle.close();
    };

    process.on("SIGTERM", () => {
      void close();
    });
    process.on("SIGINT", () => {
      void close();
    });

    await new Promise<void>(() => {});
  } catch (error: unknown) {
    process.send?.({
      type: "error",
      message: error instanceof Error ? error.message : "Unknown auth session startup error.",
    } satisfies AuthServerErrorMessage);
    process.exit(1);
  }
}
