import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { getActiveWalletSigner } from "../../wallet/index.js";
import { fetchAllBalances } from "../../portfolio/index.js";
import { fetchTokenMetadata, searchTokens } from "../../pricing/index.js";
import { getSwapQuote, executeSwap, DEFAULT_SLIPPAGE_BPS } from "../../swap/index.js";
import type { TokenBalance, TokenMetadata } from "../../types/portfolio.js";
import type { SwapQuote, SwapResult } from "../../types/swap.js";
import { copyToClipboard } from "../../clipboard/index.js";

type SwapStep =
  | "select-source"
  | "select-dest"
  | "enter-amount"
  | "preview"
  | "executing"
  | "result";

interface SwapScreenProps {
  walletAddress: string | null;
  rpc: Rpc<SolanaRpcApi>;
  jupiterApiKey: string;
  isActive: boolean;
  onCapturingInputChange: (capturing: boolean) => void;
  /** Pre-selected mint from portfolio screen. */
  preSelectedMint: string | null;
  onPreSelectedMintConsumed: () => void;
  /** Called when a swap completes successfully. */
  onTransactionComplete: () => void;
}

/** Truncate a mint address for display. */
function truncateMint(mint: string): string {
  if (mint.length <= 11) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

/** Format a token amount with appropriate decimals. */
function formatAmount(amount: string, decimals: number): string {
  const num = Number(amount) / 10 ** decimals;
  if (num >= 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (num >= 1) return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return num.toLocaleString("en-US", { maximumFractionDigits: Math.min(decimals, 6) });
}

export default function SwapScreen({
  walletAddress,
  rpc,
  jupiterApiKey,
  isActive,
  onCapturingInputChange,
  preSelectedMint,
  onPreSelectedMintConsumed,
  onTransactionComplete,
}: SwapScreenProps) {
  // --- State ---
  const [step, setStep] = useState<SwapStep>("select-source");
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [metadata, setMetadata] = useState<Map<string, TokenMetadata>>(new Map());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sourceToken, setSourceToken] = useState<TokenBalance | null>(null);
  const [destMint, setDestMint] = useState<string>("");
  const [destToken, setDestToken] = useState<TokenMetadata | null>(null);
  const [destSearch, setDestSearch] = useState("");
  const [destResults, setDestResults] = useState<TokenMetadata[]>([]);
  const [destSearchIndex, setDestSearchIndex] = useState(0);
  const [amountInput, setAmountInput] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [swapStatus, setSwapStatus] = useState("Preparing...");
  const [swapResult, setSwapResult] = useState<SwapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [searchingTokens, setSearchingTokens] = useState(false);
  const [copied, setCopied] = useState(false);
  const fetchInFlight = useRef(false);

  // Notify parent when text input capture state changes.
  const isCapturing = step === "select-dest" || step === "enter-amount";
  useEffect(() => {
    onCapturingInputChange(isCapturing);
  }, [isCapturing, onCapturingInputChange]);

  // --- Data loading ---

  const loadBalances = useCallback(async () => {
    if (!walletAddress || fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoadingBalances(true);
    try {
      const bals = await fetchAllBalances(rpc, walletAddress);
      const mints = bals.map((b) => b.mint);
      const meta = await fetchTokenMetadata(mints, jupiterApiKey);
      setBalances(bals);
      setMetadata(meta);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load balances");
    } finally {
      setLoadingBalances(false);
      fetchInFlight.current = false;
    }
  }, [walletAddress, rpc, jupiterApiKey]);

  // Auto-load balances when entering the source selection step.
  useEffect(() => {
    if (step === "select-source" && balances.length === 0 && !loadingBalances && !error && walletAddress) {
      loadBalances();
    }
  }, [step, balances.length, loadingBalances, error, walletAddress, loadBalances]);

  // Handle pre-selected mint from portfolio.
  useEffect(() => {
    if (preSelectedMint && balances.length > 0 && step === "select-source") {
      const token = balances.find((b) => b.mint === preSelectedMint);
      if (token) {
        setSourceToken(token);
        setStep("select-dest");
      }
      onPreSelectedMintConsumed();
    }
  }, [preSelectedMint, balances, step, onPreSelectedMintConsumed]);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, []);

  const searchDestToken = useCallback((query: string) => {
    if (searchDebounce.current) {
      clearTimeout(searchDebounce.current);
    }

    if (query.length < 2) {
      setDestResults([]);
      return;
    }

    searchDebounce.current = setTimeout(async () => {
      setSearchingTokens(true);
      try {
        const results = await searchTokens(query, jupiterApiKey);
        setDestResults(results);
        setDestSearchIndex(0);
      } catch {
        // Silently fail — user can retry.
      } finally {
        setSearchingTokens(false);
      }
    }, 300);
  }, [jupiterApiKey]);

  const fetchQuote = useCallback(async () => {
    if (!sourceToken || !destMint || !amountInput) return;

    setLoadingQuote(true);
    setError(null);
    try {
      // Parse amount to raw units using string math to avoid floating-point errors.
      let amountNum: bigint;
      if (amountInput === "max") {
        amountNum = sourceToken.rawBalance;
      } else {
        const parsed = Number(amountInput);
        if (Number.isNaN(parsed) || parsed <= 0) {
          setError("Enter a valid amount greater than 0.");
          setLoadingQuote(false);
          return;
        }
        const [whole = "0", frac = ""] = amountInput.split(".");
        const paddedFrac = frac.padEnd(sourceToken.decimals, "0").slice(0, sourceToken.decimals);
        amountNum = BigInt(whole + paddedFrac);
      }

      const q = await getSwapQuote(
        {
          inputMint: sourceToken.mint,
          outputMint: destMint,
          amount: String(amountNum),
          slippageBps: DEFAULT_SLIPPAGE_BPS,
        },
        jupiterApiKey,
      );
      setQuote(q);
      setStep("preview");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to get quote");
    } finally {
      setLoadingQuote(false);
    }
  }, [sourceToken, destMint, amountInput, jupiterApiKey]);

  const doSwap = useCallback(async () => {
    if (!quote) return;

    setStep("executing");
    setSwapStatus("Preparing...");
    try {
      const signer = await getActiveWalletSigner();
      if (!signer) {
        throw new Error("No active wallet signer available.");
      }
      const result = await executeSwap(quote, signer, rpc, jupiterApiKey, setSwapStatus);
      setSwapResult(result);
      setStep("result");
      if (result.success) onTransactionComplete();
    } catch (err: unknown) {
      setSwapResult({
        success: false,
        signature: null,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        error: err instanceof Error ? err.message : "Unknown swap error",
      });
      setStep("result");
    }
  }, [quote, rpc, jupiterApiKey, onTransactionComplete]);

  // --- Reset ---

  const resetSwap = useCallback(() => {
    setStep("select-source");
    setSourceToken(null);
    setDestMint("");
    setDestToken(null);
    setDestSearch("");
    setDestResults([]);
    setDestSearchIndex(0);
    setAmountInput("");
    setQuote(null);
    setSwapResult(null);
    setError(null);
    setSelectedIndex(0);
    setBalances([]);
  }, []);

  // --- Input handling ---

  useInput(
    (input, key) => {
      if (!isActive) return;

      // Global escape — go back one step or reset.
      if (key.escape) {
        if (step === "result") {
          resetSwap();
        } else if (step === "preview") {
          setStep("enter-amount");
          setQuote(null);
        } else if (step === "enter-amount") {
          setStep("select-dest");
          setAmountInput("");
        } else if (step === "select-dest") {
          setStep("select-source");
          setDestSearch("");
          setDestResults([]);
          setDestMint("");
          setDestToken(null);
        }
        return;
      }

      // --- Select source token ---
      if (step === "select-source") {
        if (key.upArrow) {
          setSelectedIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedIndex((i) => Math.min(balances.length - 1, i + 1));
          return;
        }
        if (key.return && balances.length > 0) {
          setSourceToken(balances[selectedIndex]);
          setSelectedIndex(0);
          setStep("select-dest");
          return;
        }
        return;
      }

      // --- Select destination token ---
      if (step === "select-dest") {
        const maxVisible = Math.min(destResults.length, 10);
        if (key.upArrow && maxVisible > 0) {
          setDestSearchIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow && maxVisible > 0) {
          setDestSearchIndex((i) => Math.min(maxVisible - 1, i + 1));
          return;
        }
        if (key.return && maxVisible > 0) {
          const selected = destResults[destSearchIndex];
          setDestMint(selected.mint);
          setDestToken(selected);
          setStep("enter-amount");
          return;
        }
        if (key.backspace || key.delete) {
          const next = destSearch.slice(0, -1);
          setDestSearch(next);
          searchDestToken(next);
          return;
        }
        // Printable characters for search (supports paste).
        if (input && !key.ctrl && !key.meta) {
          const next = destSearch + input;
          setDestSearch(next);
          searchDestToken(next);
          return;
        }
        return;
      }

      // --- Enter amount ---
      if (step === "enter-amount") {
        if (key.return && amountInput.length > 0) {
          fetchQuote();
          return;
        }
        if (key.backspace || key.delete) {
          setAmountInput((v) => v.slice(0, -1));
          return;
        }
        // Allow digits, dot (once), and "max".
        if (input && !key.ctrl && !key.meta && input.length === 1) {
          if (/\d/.test(input) || (input === "." && !amountInput.includes(".")) || (input === "m" && amountInput === "")) {
            setAmountInput((v) => v + input);
          } else if (input === "a" && amountInput === "m") {
            setAmountInput("ma");
          } else if (input === "x" && amountInput === "ma") {
            setAmountInput("max");
          }
          return;
        }
        return;
      }

      // --- Preview ---
      if (step === "preview") {
        if (input === "c" || key.return) {
          doSwap();
          return;
        }
        return;
      }

      // --- Result ---
      if (step === "result") {
        if (input === "y" && swapResult?.signature) {
          if (copyToClipboard(swapResult.signature)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
          return;
        }
        if (key.return || input === "n") {
          resetSwap();
          return;
        }
        return;
      }
    },
    { isActive },
  );

  // --- No wallet ---

  if (!walletAddress) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Swap</Text>
        <Box marginTop={1}>
          <Text color="yellow">No wallet configured. Press [w] to manage wallets.</Text>
        </Box>
      </Box>
    );
  }

  // --- Render by step ---

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Swap</Text>

      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Step: Select source token */}
      {step === "select-source" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Select token to swap from:</Text>
          {loadingBalances && (
            <Box marginTop={1}>
              <Text dimColor>Loading balances...</Text>
            </Box>
          )}
          {!loadingBalances && balances.length === 0 && !error && (
            <Box marginTop={1}>
              <Text dimColor>No tokens found.</Text>
            </Box>
          )}
          {balances.map((b, i) => {
            const isSelected = i === selectedIndex;
            const meta = metadata.get(b.mint);
            const symbol = meta?.symbol ?? truncateMint(b.mint);
            return (
              <Box key={b.mint}>
                <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                  {isSelected ? "> " : "  "}
                  {symbol.padEnd(10)}
                  {b.balance.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                </Text>
              </Box>
            );
          })}
          {balances.length > 0 && (
            <Box marginTop={1}>
              <Text dimColor>[up/down] navigate  [enter] select</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Step: Select destination token */}
      {step === "select-dest" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>From: </Text>
            <Text color="cyan">
              {metadata.get(sourceToken!.mint)?.symbol ?? truncateMint(sourceToken!.mint)}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Search destination token: </Text>
            <Text>{destSearch}</Text>
            <Text dimColor>_</Text>
          </Box>
          {searchingTokens && (
            <Box marginTop={1}>
              <Text dimColor>Searching...</Text>
            </Box>
          )}
          {destResults.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {destResults.slice(0, 10).map((token, i) => {
                const isSelected = i === destSearchIndex;
                return (
                  <Box key={token.mint}>
                    <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                      {isSelected ? "> " : "  "}
                      {token.symbol.padEnd(10)}
                      <Text dimColor>{token.name}</Text>
                    </Text>
                  </Box>
                );
              })}
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>[type] search  [up/down] navigate  [enter] select  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Enter amount */}
      {step === "enter-amount" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>From: </Text>
            <Text color="cyan">
              {metadata.get(sourceToken!.mint)?.symbol ?? truncateMint(sourceToken!.mint)}
            </Text>
          </Box>
          <Box>
            <Text dimColor>To: </Text>
            <Text color="cyan">
              {destToken?.symbol ?? truncateMint(destMint)}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Available: </Text>
            <Text>
              {sourceToken!.balance.toLocaleString("en-US", { maximumFractionDigits: 6 })}
              {" "}
              {metadata.get(sourceToken!.mint)?.symbol ?? ""}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Amount: </Text>
            <Text>{amountInput || " "}</Text>
            <Text dimColor>_</Text>
          </Box>
          {loadingQuote && (
            <Box marginTop={1}>
              <Text dimColor>Fetching quote...</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>[type] amount or &quot;max&quot;  [enter] get quote  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Preview quote */}
      {step === "preview" && quote && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Swap Preview</Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text dimColor>{"Sell:      "}</Text>
              <Text>
                {formatAmount(quote.inAmount, sourceToken!.decimals)}{" "}
                {metadata.get(quote.inputMint)?.symbol ?? truncateMint(quote.inputMint)}
              </Text>
            </Box>
            <Box>
              <Text dimColor>{"Receive:   "}</Text>
              <Text color="green">
                {formatAmount(quote.outAmount, destToken?.decimals ?? 6)}{" "}
                {destToken?.symbol ?? truncateMint(quote.outputMint)}
              </Text>
            </Box>
            <Box>
              <Text dimColor>{"Min out:   "}</Text>
              <Text>
                {formatAmount(quote.otherAmountThreshold, destToken?.decimals ?? 6)}
              </Text>
            </Box>
            <Box>
              <Text dimColor>{"Slippage:  "}</Text>
              <Text>{(quote.slippageBps / 100).toFixed(2)}%</Text>
            </Box>
            <Box>
              <Text dimColor>{"Impact:    "}</Text>
              <Text
                color={Number(quote.priceImpactPct) > 1 ? "red" : Number(quote.priceImpactPct) > 0.1 ? "yellow" : undefined}
              >
                {Number(quote.priceImpactPct).toFixed(4)}%
              </Text>
            </Box>
            {quote.routePlan.length > 0 && (
              <Box marginTop={1} flexDirection="column">
                <Text dimColor>Route:</Text>
                {quote.routePlan.map((hop, i) => (
                  <Box key={i} paddingLeft={2}>
                    <Text dimColor>
                      {hop.ammLabel} ({hop.percent}%)
                    </Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>[c/enter] confirm swap  [esc] back</Text>
          </Box>
        </Box>
      )}

      {/* Step: Executing */}
      {step === "executing" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>{swapStatus}</Text>
        </Box>
      )}

      {/* Step: Result */}
      {step === "result" && swapResult && (
        <Box flexDirection="column" marginTop={1}>
          {swapResult.success ? (
            <>
              <Text color="green" bold>Swap successful!</Text>
              <Box marginTop={1} flexDirection="column">
                <Box>
                  <Text dimColor>{"Sold:     "}</Text>
                  <Text>
                    {formatAmount(swapResult.inAmount, sourceToken?.decimals ?? 9)}{" "}
                    {metadata.get(swapResult.inputMint)?.symbol ?? truncateMint(swapResult.inputMint)}
                  </Text>
                </Box>
                <Box>
                  <Text dimColor>{"Received: "}</Text>
                  <Text color="green">
                    {formatAmount(swapResult.outAmount, destToken?.decimals ?? 6)}{" "}
                    {destToken?.symbol ?? truncateMint(swapResult.outputMint)}
                  </Text>
                </Box>
                <Box>
                  <Text dimColor>{"Tx:       "}</Text>
                  <Text>{swapResult.signature}</Text>
                </Box>
              </Box>
            </>
          ) : (
            <>
              <Text color="red" bold>Swap failed</Text>
              <Box marginTop={1}>
                <Text color="red">{swapResult.error}</Text>
              </Box>
            </>
          )}
          <Box marginTop={1} gap={2}>
            <Text dimColor>
              [enter/n] new swap{swapResult.success ? "  [y] copy tx" : ""}  [esc] back
            </Text>
            {copied && <Text color="green">copied!</Text>}
          </Box>
        </Box>
      )}
    </Box>
  );
}
