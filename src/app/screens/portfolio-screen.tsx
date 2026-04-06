import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { fetchAllBalances } from "../../portfolio/index.js";
import { fetchTokenMetadata, fetchTokenPrices } from "../../pricing/index.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import {
  truncateAddress,
  formatUsd,
  formatBalance,
  formatPercent,
  timeAgo,
  getAssetName,
  getAssetSymbol,
} from "../../lib/format.js";
import type {
  PortfolioRow,
  PortfolioSummary,
  SelectedAssetRef,
  TokenBalance,
  TokenMetadata,
  TokenPrice,
} from "../../types/portfolio.js";

/** Interval between auto-refreshes in milliseconds. */
const AUTO_REFRESH_INTERVAL_MS = 30_000;

interface PortfolioScreenProps {
  walletAddress: string | null;
  rpc: Rpc<SolanaRpcApi>;
  jupiterApiKey: string;
  isActive: boolean;
  onSelectedMintChange: (asset: SelectedAssetRef | null) => void;
  /** Increment to trigger a data refresh from outside the component. */
  refreshKey: number;
}

/** Build enriched portfolio rows from balances, metadata, and prices. */
function buildPortfolioRows(
  balances: TokenBalance[],
  metadata: Map<string, TokenMetadata>,
  prices: Map<string, TokenPrice>,
): PortfolioRow[] {
  return balances
    .filter((b) => b.balance > 0)
    .map((b) => {
      const meta = metadata.get(b.mint);
      const price = prices.get(b.mint);
      const usdPrice = price?.usdPrice ?? null;
      const usdValue = usdPrice !== null ? b.balance * usdPrice : null;

      return {
        id: b.id,
        mint: b.mint,
        accountAddress: b.accountAddress,
        assetKind: b.assetKind,
        symbol: getAssetSymbol(b.assetKind, b.mint, meta?.symbol ?? null),
        name: getAssetName(b.assetKind, b.mint, meta?.name ?? null),
        iconUrl: meta?.iconUrl ?? null,
        balance: b.balance,
        decimals: b.decimals,
        isNative: b.isNative,
        usdPrice,
        usdValue,
        priceChange24h: price?.priceChange24h ?? null,
      };
    });
}

/** Compute portfolio summary from rows. */
function computeSummary(rows: PortfolioRow[]): PortfolioSummary {
  let totalValue = 0;
  let change24h = 0;

  for (const row of rows) {
    if (row.usdValue !== null) {
      totalValue += row.usdValue;
    }
    if (row.usdValue !== null && row.priceChange24h !== null) {
      // Estimate yesterday's value and compute dollar change.
      const yesterdayValue = row.usdValue / (1 + row.priceChange24h / 100);
      change24h += row.usdValue - yesterdayValue;
    }
  }

  return {
    totalValue,
    change24h,
    changePercent24h:
      totalValue > 0 ? (change24h / (totalValue - change24h)) * 100 : null,
  };
}


// --- Column widths ---

const COL = {
  token: 12,
  balance: 16,
  price: 14,
  value: 14,
  change: 10,
};

export default function PortfolioScreen({
  walletAddress,
  rpc,
  jupiterApiKey,
  isActive,
  onSelectedMintChange,
  refreshKey,
}: PortfolioScreenProps) {
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  // Notify parent of selected mint — only when detail drawer is open.
  useEffect(() => {
    const selectedMint = showDetail
      ? rows[selectedIndex]
        ? {
            id: rows[selectedIndex].id,
            mint: rows[selectedIndex].mint,
            assetKind: rows[selectedIndex].assetKind,
          }
        : null
      : null;
    onSelectedMintChange(selectedMint);
  }, [selectedIndex, rows, showDetail, onSelectedMintChange]);

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchInFlight = useRef(false);

  const fetchData = useCallback(
    async (isInitial: boolean) => {
      if (!walletAddress) return;
      if (fetchInFlight.current) return;
      fetchInFlight.current = true;

      if (isInitial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const balances = await fetchAllBalances(rpc, walletAddress);
        const mints = [...new Set(balances.map((b) => b.mint))];

        const [metadata, prices] = await Promise.all([
          fetchTokenMetadata(mints, jupiterApiKey),
          fetchTokenPrices(mints, jupiterApiKey),
        ]);

        const newRows = buildPortfolioRows(balances, metadata, prices);
        const newSummary = computeSummary(newRows);

        setRows(newRows);
        setSummary(newSummary);
        setSelectedIndex((prev) =>
          Math.min(prev, Math.max(0, newRows.length - 1)),
        );
        setError(null);
        setRefreshError(false);
        setLastUpdated(new Date());
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Unknown error fetching portfolio";
        if (isInitial) {
          setError(message);
        } else {
          setRefreshError(true);
        }
      } finally {
        fetchInFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [walletAddress, rpc, jupiterApiKey],
  );

  // Initial fetch.
  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // External refresh trigger (e.g. after swap or transfer).
  useEffect(() => {
    if (isActive && refreshKey > 0) {
      fetchData(false);
    }
  }, [isActive, refreshKey, fetchData]);

  // Auto-refresh timer.
  useEffect(() => {
    if (!isActive) {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
      return;
    }

    refreshTimer.current = setInterval(() => {
      fetchData(false);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [isActive, fetchData]);

  // Close detail drawer when leaving the screen.
  useEffect(() => {
    if (!isActive) {
      setShowDetail(false);
    }
  }, [isActive]);

  // Tick the "last updated" display every 10 seconds.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard input.
  useInput(
    (input, key) => {
      if (!isActive) return;

      // Manual refresh.
      if (input === "r") {
        fetchData(false);
        return;
      }

      // Row navigation — detail drawer stays open while moving.
      if (key.upArrow && rows.length > 0) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow && rows.length > 0) {
        setSelectedIndex((i) => Math.min(rows.length - 1, i + 1));
        return;
      }

      // Close detail drawer.
      if (key.escape && showDetail) {
        setShowDetail(false);
        return;
      }

      // Copy mint address when detail drawer is open.
      if (input === "y" && showDetail && rows[selectedIndex]) {
        if (copyToClipboard(rows[selectedIndex].mint)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
        return;
      }

      // Toggle detail.
      if (key.return && rows.length > 0) {
        setShowDetail((v) => !v);
        return;
      }
    },
    { isActive },
  );

  // --- No wallet state ---

  if (!walletAddress) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Portfolio</Text>
        <Box marginTop={1}>
          <Text color="yellow">
            No wallet configured. Press [w] to manage wallets.
          </Text>
        </Box>
      </Box>
    );
  }

  // --- Loading state ---

  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Portfolio</Text>
        <Box marginTop={1}>
          <Text dimColor>Loading portfolio...</Text>
        </Box>
      </Box>
    );
  }

  // --- Error state ---

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Portfolio</Text>
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press [r] to retry.</Text>
        </Box>
      </Box>
    );
  }

  // --- Empty state ---

  if (rows.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Portfolio</Text>
        <Box marginTop={1}>
          <Text dimColor>
            No tokens found. Fund your wallet or import a different one.
          </Text>
        </Box>
      </Box>
    );
  }

  // --- Data view ---

  const selected = rows[selectedIndex];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Status bar */}
      <Box justifyContent="space-between">
        <Text bold>Portfolio</Text>
        <Box gap={2}>
          {refreshing && <Text dimColor>refreshing...</Text>}
          {refreshError && !refreshing && (
            <Text color="yellow">refresh failed</Text>
          )}
          {lastUpdated && !refreshing && (
            <Text dimColor>updated {timeAgo(lastUpdated)}</Text>
          )}
        </Box>
      </Box>

      {/* Summary */}
      {summary && (
        <Box marginTop={1} gap={3}>
          <Box>
            <Text dimColor>Total: </Text>
            <Text bold>{formatUsd(summary.totalValue)}</Text>
          </Box>
          {summary.changePercent24h !== null && (
            <Box>
              <Text dimColor>24h: </Text>
              <Text color={summary.change24h >= 0 ? "green" : "red"}>
                {summary.change24h >= 0 ? "+" : ""}
                {formatUsd(Math.abs(summary.change24h))} (
                {formatPercent(summary.changePercent24h)})
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Table header */}
      <Box marginTop={1}>
        <Text dimColor>
          {"  "}
          {"TOKEN".padEnd(COL.token)}
          {"BALANCE".padStart(COL.balance)}
          {"PRICE".padStart(COL.price)}
          {"VALUE".padStart(COL.value)}
          {"24H".padStart(COL.change)}
        </Text>
      </Box>

      {/* Table rows */}
      {rows.map((row, i) => {
        const isSelected = i === selectedIndex;
        const indicator = isSelected ? "> " : "  ";

        return (
          <Box key={row.id}>
            <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
              {indicator}
              {row.symbol.padEnd(COL.token)}
              {formatBalance(row.balance, row.decimals).padStart(COL.balance)}
              {(row.usdPrice !== null ? formatUsd(row.usdPrice) : "-").padStart(
                COL.price,
              )}
              {(row.usdValue !== null ? formatUsd(row.usdValue) : "-").padStart(
                COL.value,
              )}
            </Text>
            {row.priceChange24h !== null ? (
              <Text color={row.priceChange24h >= 0 ? "green" : "red"}>
                {formatPercent(row.priceChange24h).padStart(COL.change)}
              </Text>
            ) : (
              <Text dimColor>{"-".padStart(COL.change)}</Text>
            )}
          </Box>
        );
      })}

      {/* Detail drawer */}
      {showDetail && selected && (
        <Box
          marginTop={1}
          paddingX={1}
          paddingY={1}
          borderStyle="single"
          flexDirection="column"
        >
          <Text bold>{selected.name}</Text>
          <Box marginTop={1} flexDirection="column" gap={0}>
            <Box>
              <Text dimColor>{"Symbol:    "}</Text>
              <Text>{selected.symbol}</Text>
            </Box>
            <Box>
              <Text dimColor>{"Mint:      "}</Text>
              <Text>{selected.mint}</Text>
            </Box>
            {selected.accountAddress && (
              <Box>
                <Text dimColor>{"Account:   "}</Text>
                <Text>{selected.accountAddress}</Text>
              </Box>
            )}
            <Box>
              <Text dimColor>{"Balance:   "}</Text>
              <Text>{formatBalance(selected.balance, selected.decimals)}</Text>
            </Box>
            <Box>
              <Text dimColor>{"Decimals:  "}</Text>
              <Text>{String(selected.decimals)}</Text>
            </Box>
            {selected.usdPrice !== null && (
              <Box>
                <Text dimColor>{"Price:     "}</Text>
                <Text>{formatUsd(selected.usdPrice)}</Text>
              </Box>
            )}
            {selected.usdValue !== null && (
              <Box>
                <Text dimColor>{"Value:     "}</Text>
                <Text>{formatUsd(selected.usdValue)}</Text>
              </Box>
            )}
            {selected.priceChange24h !== null && (
              <Box>
                <Text dimColor>{"24h:       "}</Text>
                <Text color={selected.priceChange24h >= 0 ? "green" : "red"}>
                  {formatPercent(selected.priceChange24h)}
                </Text>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Navigation hint */}
      <Box marginTop={1} gap={2}>
        <Text dimColor>
          {showDetail
            ? "[up/down] navigate  [y] copy mint  [esc] close"
            : "[up/down] navigate  [enter] details"}
        </Text>
        {copied && <Text color="green">copied!</Text>}
      </Box>
    </Box>
  );
}
