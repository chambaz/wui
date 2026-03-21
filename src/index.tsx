#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadConfig } from "./lib/config.js";
import { initRpc, checkRpcHealth } from "./lib/rpc.js";
import { getActiveWalletEntry } from "./wallet/index.js";
import App from "./app/app.js";
import Setup from "./app/setup.js";
import { parseArgs } from "./cli/index.js";
import { portfolioCommand } from "./cli/portfolio.js";
import { activityCommand } from "./cli/activity.js";
import { sendCommand } from "./cli/send.js";
import type { AppConfig } from "./lib/config.js";

/** Launch the interactive TUI. */
async function launchApp(config: AppConfig) {
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
    />,
  );
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
  send         Send tokens: wui send <address> <amount> <token>

Options:
  --json       Output as JSON (non-interactive commands only)`;

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
