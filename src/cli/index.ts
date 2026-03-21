import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { loadConfig } from "../lib/config.js";
import { initRpc, checkRpcHealth } from "../lib/rpc.js";
import { getActiveWalletEntry } from "../wallet/index.js";
import type { AppConfig } from "../lib/config.js";
import type { WalletEntry } from "../types/wallet.js";

/** Parsed CLI arguments. */
export interface CliArgs {
  command: string;
  args: string[];
  json: boolean;
}

/** Bootstrap context for CLI commands that need RPC + wallet. */
export interface CliContext {
  config: AppConfig;
  rpc: Rpc<SolanaRpcApi>;
  wallet: WalletEntry;
}

/** Parse process.argv into a structured command + flags. */
export function parseArgs(argv: string[]): CliArgs {
  const raw = argv.slice(2);
  const json = raw.includes("--json");

  // Check for help flags before filtering.
  if (raw.includes("--help") || raw.includes("-h")) {
    return { command: "help", args: [], json: false };
  }

  const positional = raw.filter((a) => !a.startsWith("-"));
  return {
    command: positional[0] ?? "",
    args: positional.slice(1),
    json,
  };
}

/**
 * Bootstrap the config, RPC, and active wallet.
 * Throws with a user-friendly message if anything is missing.
 */
export async function bootstrap(): Promise<CliContext> {
  const config = loadConfig();
  if (!config) {
    throw new Error("Not configured. Run `wui` to set up.");
  }

  const rpc = initRpc(config.solanaRpcUrl);
  const healthy = await checkRpcHealth(rpc);
  if (!healthy) {
    throw new Error(
      `Cannot reach RPC at ${config.solanaRpcUrl}\nCheck your SOLANA_RPC_URL and network connection.`,
    );
  }

  const wallet = getActiveWalletEntry();
  if (!wallet) {
    throw new Error("No active wallet. Run `wui` and press [w] to create or import one.");
  }

  return { config, rpc, wallet };
}

/** Print JSON output with BigInt handling. */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
}

/** Print a simple table with padded columns. */
export function printTable(headers: string[], rows: string[][], colWidths: number[]): void {
  const header = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(colWidths[i])).join("  "));
  }
}
