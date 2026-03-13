#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config/index.js";
import { initRpc, checkRpcHealth } from "./rpc/index.js";
import App from "./app/App.js";

async function main() {
  const config = loadConfig();
  const rpc = initRpc(config.solanaRpcUrl);

  const healthy = await checkRpcHealth(rpc);
  if (!healthy) {
    throw new Error(
      `Cannot reach RPC at ${config.solanaRpcUrl}\n` +
        `Check your SOLANA_RPC_URL and network connection.`
    );
  }

  render(<App />);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
