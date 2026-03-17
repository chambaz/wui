#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config/index.js";
import { initRpc, checkRpcHealth } from "./rpc/index.js";
import { getActiveWalletEntry } from "./wallet/index.js";
import type { AppConfig } from "./config/index.js";
import App from "./app/app.js";
import Setup from "./app/setup.js";

/** Launch the main app with a validated config. */
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

async function main() {
  const config = loadConfig();

  if (config) {
    // Config exists — launch the app directly.
    await launchApp(config);
  } else {
    // No config — show interactive setup, then launch.
    const { unmount, waitUntilExit } = render(
      <Setup
        onComplete={() => {
          unmount();
          const newConfig = loadConfig();
          if (newConfig) {
            launchApp(newConfig).catch((err: Error) => {
              console.error(err.message);
              process.exit(1);
            });
          }
        }}
      />,
    );
    await waitUntilExit();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
