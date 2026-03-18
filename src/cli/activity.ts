import { fetchRecentActivity } from "../activity/index.js";
import type { ActivityEntry } from "../types/activity.js";
import { bootstrap, printJson, printTable } from "./index.js";

/** Format a unix timestamp to a relative or short string. */
function formatTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Map activity type to a short label. */
function typeLabel(type: string): string {
  switch (type) {
    case "swap": return "SWAP";
    case "transfer-in": return "IN";
    case "transfer-out": return "OUT";
    default: return "TX";
  }
}

/** Truncate a string. */
function truncate(s: string, len: number): string {
  return s.length <= len ? s : s.slice(0, len - 1) + "…";
}

export async function activityCommand(json: boolean): Promise<void> {
  const { config, rpc, wallet } = await bootstrap();

  const entries = await fetchRecentActivity(rpc, wallet.publicKey, config.jupiterApiKey, 15);

  if (json) {
    printJson({
      wallet: wallet.publicKey,
      transactions: entries.map((e) => ({
        signature: e.signature,
        type: e.type,
        summary: e.summary,
        timestamp: e.timestamp,
        success: e.success,
        error: e.error,
      })),
    });
    return;
  }

  console.log(`Wallet: ${wallet.publicKey}`);
  console.log();

  if (entries.length === 0) {
    console.log("No recent activity.");
    return;
  }

  const colWidths = [6, 12, 36, 12];
  const tableRows = entries.map((e) => [
    typeLabel(e.type),
    e.signature.slice(0, 8) + "…",
    truncate(e.summary, 36),
    e.timestamp ? formatTime(e.timestamp) : "-",
  ]);

  printTable(["TYPE", "TX", "DETAILS", "WHEN"], tableRows, colWidths);
}
