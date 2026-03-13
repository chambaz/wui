#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config/index.js";
import { initRpc, checkRpcHealth } from "./rpc/index.js";
import { getActiveWalletEntry } from "./wallet/index.js";
import App from "./app/app.js";

async function main() {
  const config = loadConfig();
  const rpc = initRpc(config.solanaRpcUrl);

  const rpcConnected = await checkRpcHealth(rpc);
  if (!rpcConnected) {
    throw new Error(
      `Cannot reach RPC at ${config.solanaRpcUrl}\n` +
        `Check your SOLANA_RPC_URL and network connection.`
    );
  }

  const wallet = getActiveWalletEntry();

  render(<App wallet={wallet} rpcConnected={rpcConnected} />);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
