/** Wrapped SOL mint address — used to represent native SOL across modules. */
export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Jupiter API base URL. */
export const JUPITER_BASE_URL = "https://api.jup.ag";

/** Truncate a Solana address or mint for display (e.g. "5Utc...WSJ5"). */
export function truncateAddress(addr: string): string {
  if (addr.length <= 11) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

/** Format a number with commas and fixed decimal places. */
export function formatNumber(n: number, decimals: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a USD value with appropriate precision. */
export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${formatNumber(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `$${formatNumber(value, 2)}`;
  if (value >= 1) return `$${formatNumber(value, 2)}`;
  if (value >= 0.01) return `$${formatNumber(value, 4)}`;
  return `$${value.toFixed(6)}`;
}

/** Format a token balance for display (more precision for smaller values). */
export function formatBalance(balance: number, decimals: number): string {
  const displayDecimals = balance >= 1000 ? 2 : balance >= 1 ? 4 : Math.min(decimals, 6);
  return formatNumber(balance, displayDecimals);
}

/** Format a percentage change with sign (e.g. "+1.23%" or "-0.50%"). */
export function formatPercent(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** Format a token amount from raw string (e.g. for swap/transfer display). */
export function formatAmount(amount: string, decimals: number): string {
  const num = Number(amount) / 10 ** decimals;
  if (num >= 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (num >= 1) return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return num.toLocaleString("en-US", { maximumFractionDigits: Math.min(decimals, 6) });
}

/** Format a unix timestamp as relative time (e.g. "5m ago", "2d ago"). */
export function formatTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Format a number compactly (e.g. "1.23K", "4.56M"). */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}
