import { config as loadDotenv } from "dotenv";

export interface AppConfig {
  solanaRpcUrl: string;
  jupiterApiKey: string;
}

export function loadConfig(): AppConfig {
  loadDotenv({ quiet: true });

  const missing: string[] = [];
  if (!process.env.SOLANA_RPC_URL) missing.push("SOLANA_RPC_URL");
  if (!process.env.JUPITER_API_KEY) missing.push("JUPITER_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        `Create a .env file or set them in your shell. See .env.example for reference.`
    );
  }

  return {
    solanaRpcUrl: process.env.SOLANA_RPC_URL!,
    jupiterApiKey: process.env.JUPITER_API_KEY!,
  };
}
