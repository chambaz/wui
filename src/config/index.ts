import { config as loadDotenv } from "dotenv";

export interface AppConfig {
  solanaRpcUrl: string;
  jupiterApiKey: string;
}

export function loadConfig(): AppConfig {
  loadDotenv({ quiet: true });

  const solanaRpcUrl = process.env.SOLANA_RPC_URL;
  const jupiterApiKey = process.env.JUPITER_API_KEY;

  const missing: string[] = [];
  if (!solanaRpcUrl) missing.push("SOLANA_RPC_URL");
  if (!jupiterApiKey) missing.push("JUPITER_API_KEY");

  if (missing.length > 0) {
    console.error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        `Create a .env file or set them in your shell. See .env.example for reference.`
    );
    process.exit(1);
  }

  return {
    solanaRpcUrl: solanaRpcUrl!,
    jupiterApiKey: jupiterApiKey!,
  };
}
