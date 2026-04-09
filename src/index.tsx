#!/usr/bin/env node
import { render } from "ink";
import packageJson from "../package.json";
import { loadConfig } from "./lib/config.js";
import { initRpc, checkRpcHealth } from "./lib/rpc.js";
import { getActiveWalletEntry, hasLegacyWallets } from "./wallet/index.js";
import App from "./app/app.js";
import MigrateWallets from "./app/migrate-wallets.js";
import Setup from "./app/setup.js";
import { parseArgs } from "./cli/index.js";
import { portfolioCommand } from "./cli/portfolio.js";
import { activityCommand } from "./cli/activity.js";
import { sendCommand } from "./cli/send.js";
import { walletCommand } from "./cli/wallet.js";
import { unwrapCommand, wrapCommand } from "./cli/wrap.js";
import type { AppConfig } from "./lib/config.js";

/** Launch the interactive TUI. */
async function launchApp(config: AppConfig): Promise<void> {
  if (hasLegacyWallets()) {
    return launchMigration(() => {
      const refreshedConfig = loadConfig();
      if (!refreshedConfig) {
        throw new Error("Configuration not found after wallet migration.");
      }
      return launchApp(refreshedConfig);
    });
  }

  const rpc = initRpc(config.solanaRpcUrl);

  const rpcConnected = await checkRpcHealth(rpc);
  if (!rpcConnected) {
    throw new Error(
      `Cannot reach RPC at ${config.solanaRpcUrl}\n` +
        `Check your SOLANA_RPC_URL and network connection.`,
    );
  }

  const wallet = getActiveWalletEntry();

  render(
    <App
      wallet={wallet}
      rpcConnected={rpcConnected}
      rpc={rpc}
      config={config}
      version={packageJson.version}
    />,
  );
}

/** Launch the one-time wallet migration flow. */
function launchMigration(onComplete: () => void | Promise<void>): Promise<void> {
  const { unmount, waitUntilExit } = render(
    <MigrateWallets
      onComplete={() => {
        unmount();
        Promise.resolve(onComplete()).catch((err: Error) => {
          console.error(err.message);
          process.exit(1);
        });
      }}
    />,
  );

  return waitUntilExit().then(() => undefined);
}

/** Launch the interactive setup flow. */
function launchSetup(onComplete?: () => void) {
  const { unmount, waitUntilExit } = render(
    <Setup
      onComplete={() => {
        unmount();
        if (onComplete) {
          onComplete();
        } else {
          const newConfig = loadConfig();
          if (newConfig) {
            launchApp(newConfig).catch((err: Error) => {
              console.error(err.message);
              process.exit(1);
            });
          }
        }
      }}
    />,
  );
  return waitUntilExit();
}

const USAGE = `Usage: wui [command] [options]

Commands:
  (none)       Launch interactive TUI
  config       Re-run configuration setup
  portfolio    Print portfolio balances
  activity     Print recent transaction activity
  wallet       Wallet commands: wui wallet <current|use>
  wrap         Wrap native SOL: wui wrap <amount|max>
  unwrap       Unwrap standard WSOL: wui unwrap
  send         Send tokens: wui send <address> <amount> <token>

Options:
  --json       Output CLI command results as JSON`;

async function main() {
  const { command, args, json } = parseArgs(process.argv);

  // Non-interactive CLI commands.
  switch (command) {
    case "portfolio":
      await portfolioCommand(json);
      return;
    case "activity":
      await activityCommand(json);
      return;
    case "send":
      await sendCommand(args, json);
      return;
    case "wallet":
      await walletCommand(args, json);
      return;
    case "wrap":
      await wrapCommand(args, json);
      return;
    case "unwrap":
      await unwrapCommand(json);
      return;
    case "config":
      await launchSetup(() => {
        console.log("Configuration updated.");
      });
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    case "":
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      process.exit(1);
  }

  // Default: launch the interactive TUI.
  const config = loadConfig();

  if (config) {
    await launchApp(config);
  } else {
    await launchSetup();
  }
}

main().catch((err: unknown) => {
  if (err instanceof Error) {
    console.error(err.message);
    if (process.env.DEBUG) console.error(err.stack);
  } else {
    console.error(String(err));
  }
  process.exit(1);
});
