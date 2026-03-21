import { parse as parseDotenv } from "dotenv";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
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
  const env = loadEnvFile(existsSync(CONFIG_PATH) ? CONFIG_PATH : ".env");

  if (!env.SOLANA_RPC_URL || !env.JUPITER_API_KEY) {
    return null;
  }

  return {
    solanaRpcUrl: env.SOLANA_RPC_URL,
    jupiterApiKey: env.JUPITER_API_KEY,
  };
}

/** Save config to ~/.wui/.env. */
export function saveConfig(rpcUrl: string, jupiterApiKey: string): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const content = `SOLANA_RPC_URL=${rpcUrl}\nJUPITER_API_KEY=${jupiterApiKey}\n`;
  writeFileSync(CONFIG_PATH, content, { encoding: "utf-8", mode: 0o600 });
}

/** Path to the config file for display purposes. */
export const CONFIG_FILE_PATH = CONFIG_PATH;

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseDotenv(readFileSync(path, "utf-8"));
}
