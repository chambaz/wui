import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import Link from "ink-link";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { fetchRecentActivity } from "../../activity/index.js";
import type { ActivityEntry, ActivityType } from "../../types/activity.js";
import { copyToClipboard } from "../../clipboard/index.js";

/** Number of transactions to display. */
const ACTIVITY_LIMIT = 15;

interface ActivityScreenProps {
  walletAddress: string | null;
  rpc: Rpc<SolanaRpcApi>;
  jupiterApiKey: string;
  isActive: boolean;
}

/** Column widths for table layout. */
const COL = {
  type: 6,
  hash: 12,
  summary: 34,
  time: 12,
};

const SOLSCAN_TX_URL = "https://solscan.io/tx/";

/** Map activity type to a display label. */
function typeLabel(type: ActivityType): string {
  switch (type) {
    case "swap": return "SWAP";
    case "transfer-in": return "  IN";
    case "transfer-out": return " OUT";
    default: return "  TX";
  }
}

/** Map activity type to a color. */
function typeColor(type: ActivityType): string | undefined {
  switch (type) {
    case "swap": return "magenta";
    case "transfer-in": return "green";
    case "transfer-out": return "yellow";
    default: return undefined;
  }
}

/** Format a unix timestamp to a relative or short absolute string. */
function formatTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ActivityScreen({
  walletAddress,
  rpc,
  jupiterApiKey,
  isActive,
}: ActivityScreenProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [copied, setCopied] = useState(false);
  const fetchInFlight = useRef(false);

  const loadActivity = useCallback(async () => {
    if (!walletAddress || fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoading(true);
    try {
      const result = await fetchRecentActivity(rpc, walletAddress, jupiterApiKey, ACTIVITY_LIMIT);
      setEntries(result);
      setSelectedIndex((prev) => Math.min(prev, Math.max(0, result.length - 1)));
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, [walletAddress, rpc, jupiterApiKey]);

  // Load on first mount.
  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  useInput(
    (input, key) => {
      if (!isActive) return;

      if (input === "r") {
        setError(null);
        loadActivity();
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(entries.length - 1, i + 1));
        return;
      }
      if (input === "y" && showDetail && entries[selectedIndex]) {
        if (copyToClipboard(entries[selectedIndex].signature)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
        return;
      }
      if (key.return) {
        setShowDetail((v) => !v);
        return;
      }
    },
    { isActive },
  );

  // --- No wallet ---

  if (!walletAddress) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Activity</Text>
        <Box marginTop={1}>
          <Text color="yellow">No wallet configured. Press [w] to manage wallets.</Text>
        </Box>
      </Box>
    );
  }

  // --- Loading ---

  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Activity</Text>
        <Box marginTop={1}>
          <Text dimColor>Loading activity...</Text>
        </Box>
      </Box>
    );
  }

  // --- Error ---

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Activity</Text>
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press [r] to retry.</Text>
        </Box>
      </Box>
    );
  }

  // --- Empty ---

  if (entries.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Activity</Text>
        <Box marginTop={1}>
          <Text dimColor>No recent activity found.</Text>
        </Box>
      </Box>
    );
  }

  // --- Data view ---

  const selected = entries[selectedIndex];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Activity</Text>

      {/* Table header */}
      <Box marginTop={1}>
        <Text dimColor>
          {"  "}
          {"TYPE".padEnd(COL.type)}
          {"TX".padEnd(COL.hash)}
          {"DETAILS".padEnd(COL.summary)}
          {"WHEN".padStart(COL.time)}
        </Text>
      </Box>

      {/* Table rows */}
      {entries.map((entry, i) => {
        const isSelected = i === selectedIndex;
        const indicator = isSelected ? "> " : "  ";
        const time = entry.timestamp ? formatTime(entry.timestamp) : "-";
        const shortSig = `${entry.signature.slice(0, 4)}..${entry.signature.slice(-4)}`;

        return (
          <Box key={entry.signature}>
            <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
              {indicator}
            </Text>
            <Text color={typeColor(entry.type)} bold>
              {typeLabel(entry.type).padEnd(COL.type)}
            </Text>
            <Link url={`${SOLSCAN_TX_URL}${entry.signature}`}>
              <Text dimColor>{shortSig}</Text>
            </Link>
            <Text>{"  "}</Text>
            <Text color={isSelected ? "cyan" : undefined}>
              {entry.summary.padEnd(COL.summary).slice(0, COL.summary)}
            </Text>
            <Text dimColor>
              {time.padStart(COL.time)}
            </Text>
            {!entry.success && <Text color="red"> !</Text>}
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
          <Text bold>{selected.summary}</Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text dimColor>{"Type:      "}</Text>
              <Text color={typeColor(selected.type)}>{typeLabel(selected.type).trim()}</Text>
            </Box>
            <Box>
              <Text dimColor>{"Signature: "}</Text>
              <Text>{selected.signature}</Text>
            </Box>
            {selected.timestamp && (
              <Box>
                <Text dimColor>{"Time:      "}</Text>
                <Text>{new Date(selected.timestamp * 1000).toLocaleString()}</Text>
              </Box>
            )}
            <Box>
              <Text dimColor>{"Status:    "}</Text>
              <Text color={selected.success ? "green" : "red"}>
                {selected.success ? "Confirmed" : "Failed"}
              </Text>
            </Box>
            {selected.error && (
              <Box>
                <Text dimColor>{"Error:     "}</Text>
                <Text color="red">{selected.error}</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Navigation hint */}
      <Box marginTop={1} gap={2}>
        <Text dimColor>
          [up/down] navigate  [enter] details{showDetail ? "  [y] copy tx" : ""}
        </Text>
        {copied && <Text color="green">copied!</Text>}
      </Box>
    </Box>
  );
}
