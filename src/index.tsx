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
import { WALLET_USAGE, walletCommand } from "./cli/wallet.js";
import { UNWRAP_USAGE, unwrapCommand, WRAP_USAGE, wrapCommand } from "./cli/wrap.js";
import { SWAP_USAGE, swapCommand } from "./cli/swap.js";
import { STAKE_USAGE, stakeCommand, UNSTAKE_USAGE, unstakeCommand } from "./cli/stake.js";
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
  (none)       Launch the interactive TUI
  portfolio    Print portfolio balances
  activity     Print recent transaction activity

  wallet       Inspect or change the active wallet
  send         Send tokens
  swap         Swap tokens
  wrap         Wrap native SOL into WSOL
  unwrap       Unwrap standard WSOL
  stake        Stake SOL or view staking positions
  unstake      Unstake native or liquid staking positions

  config       Re-run configuration setup

Options:
  --json       Output CLI command results as JSON
  -h, --help   Show help

Examples:
  wui wallet current
  wui wallet use Dev
  wui send <address> 0.1 SOL
  wui swap 0.1 SOL JitoSOL
  wui swap dust SOL --max-usd 5
  wui swap split 1 SOL 50:JitoSOL,30:mSOL,20:JupSOL
  wui wrap max
  wui stake list

Run \`wui <command> --help\` for command-specific help.`;

const SEND_USAGE = `Usage: wui send <address> <amount> <token>

Send tokens from the active wallet.

Examples:
  wui send <address> 0.1 SOL
  wui send <address> max USDC`;

function commandUsage(command: string): string {
  switch (command) {
    case "wallet":
      return WALLET_USAGE;
    case "wrap":
      return WRAP_USAGE;
    case "unwrap":
      return UNWRAP_USAGE;
    case "swap":
      return SWAP_USAGE;
    case "stake":
      return STAKE_USAGE;
    case "unstake":
      return UNSTAKE_USAGE;
    case "send":
      return SEND_USAGE;
    case "portfolio":
      return "Usage: wui portfolio [--json]";
    case "activity":
      return "Usage: wui activity [--json]";
    case "config":
      return "Usage: wui config";
    default:
      return USAGE;
  }
}

function printHelp(command: string, args: string[]): void {
  if (command === "help") {
    console.log(commandUsage(args[0] ?? ""));
    return;
  }

  console.log(commandUsage(command));
}

async function main() {
  const { command, args, json, help } = parseArgs(process.argv);

  if (help || command === "help") {
    printHelp(command, args);
    return;
  }

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
    case "swap":
      await swapCommand(args, json);
      return;
    case "stake":
      await stakeCommand(args, json);
      return;
    case "unstake":
      await unstakeCommand(args, json);
      return;
    case "config":
      await launchSetup(() => {
        console.log("Configuration updated.");
      });
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
  const { json } = parseArgs(process.argv);
  const message = err instanceof Error ? err.message : String(err);

  if (json) {
    console.log(JSON.stringify({ error: message }, null, 2));
    if (err instanceof Error && process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }

  if (err instanceof Error) {
    console.error(message);
    if (process.env.DEBUG) console.error(err.stack);
  } else {
    console.error(message);
  }
  process.exit(1);
});
