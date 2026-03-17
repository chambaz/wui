import { config as loadDotenv } from "dotenv";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".wui");
const CONFIG_PATH = join(DATA_DIR, ".env");

export interface AppConfig {
  solanaRpcUrl: string;
  jupiterApiKey: string;
}

/**
 * Load config from ~/.wui/.env (primary) or ./.env (dev fallback).
 * Returns null if required variables are missing.
 */
export function loadConfig(): AppConfig | null {
  // Load from ~/.wui/.env first, then fall back to ./.env in working directory.
  if (existsSync(CONFIG_PATH)) {
    loadDotenv({ path: CONFIG_PATH });
  } else {
    loadDotenv({ quiet: true });
  }

  if (!process.env.SOLANA_RPC_URL || !process.env.JUPITER_API_KEY) {
    return null;
  }

  return {
    solanaRpcUrl: process.env.SOLANA_RPC_URL,
    jupiterApiKey: process.env.JUPITER_API_KEY,
  };
}

/** Save config to ~/.wui/.env. */
export function saveConfig(rpcUrl: string, jupiterApiKey: string): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const content = `SOLANA_RPC_URL=${rpcUrl}\nJUPITER_API_KEY=${jupiterApiKey}\n`;
  writeFileSync(CONFIG_PATH, content, "utf-8");
}

/** Path to the config file for display purposes. */
export const CONFIG_FILE_PATH = CONFIG_PATH;
